//! Real integrated terminal: a PTY-backed interactive shell, owned by Rust.
//!
//! Every open session gets one dedicated OS thread that drains the pty master
//! and emits `terminal:data` / `terminal:exit` to the whole webview window. The
//! frontend only ever sees strings and byte counts — no shell is ever spawned
//! through `std::process::Command`, and no shell string is ever interpolated
//! into a command line.

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, State};

/// Terminal geometry used until the frontend measures its grid.
pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;

/// Size (cols, rows) every session is spawned with, and the fallback used when
/// the frontend has not reported a measurement yet.
pub fn default_size() -> (u16, u16) {
    (DEFAULT_COLS, DEFAULT_ROWS)
}

/// One live pty. The master end lives here (resizes + the writer handle);
/// the reader end has been split off to the pump thread and the child handle
/// moved with it, so `wait()` never contends with `kill()`.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// All live terminals, keyed by session id.
///
/// Cloning a registry yields another handle onto the *same* map, which is how
/// the pump thread retires its own session once the shell exits.
#[derive(Clone, Default)]
pub struct TerminalRegistry {
    inner: Arc<Mutex<HashMap<String, Session>>>,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Number of live terminals.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.lock().map(|m| m.len()).unwrap_or(0)
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The registry lock is only ever held for a map lookup or a short pty
    /// write — never across a read, a wait, or an emit.
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, Session>>, String> {
        self.inner
            .lock()
            .map_err(|_| "internal error: terminal registry lock was poisoned".to_string())
    }

    fn insert(&self, id: String, session: Session) -> Result<(), String> {
        let mut map = self.lock()?;
        map.insert(id, session);
        Ok(())
    }

    fn remove(&self, id: &str) -> Option<Session> {
        self.lock().ok().and_then(|mut m| m.remove(id))
    }

    fn with_session<T>(
        &self,
        id: &str,
        f: impl FnOnce(&mut Session) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut map = self.lock()?;
        let session = map.get_mut(id).ok_or_else(|| {
            format!("terminal {id} is no longer open — it already exited or was closed")
        })?;
        f(session)
    }

    /// Spawn an interactive shell on a fresh pty and start its pump thread.
    pub fn open(
        &self,
        cwd: Option<String>,
        sink: Arc<dyn EventSink>,
    ) -> Result<TerminalSession, String> {
        let shell = shell_program()?;

        if let Some(dir) = cwd.as_deref() {
            if !Path::new(dir).is_dir() {
                return Err(format!(
                    "terminal working directory does not exist: {dir}"
                ));
            }
        }

        let mut cmd = CommandBuilder::new(&shell);
        #[cfg(unix)]
        cmd.env("TERM", "xterm-256color");
        if let Some(dir) = cwd.as_deref() {
            cmd.cwd(dir);
        }

        let (cols, rows) = default_size();
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("could not allocate a pseudo-terminal for {shell}: {e}"))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("could not start the shell {shell}: {e}"))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("could not attach a reader to the pty for {shell}: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("could not attach a writer to the pty for {shell}: {e}"))?;
        let killer = child.clone_killer();
        let pid = child.process_id().unwrap_or(0);
        let master = pair.master;

        let id = luminosql_core::connections::new_id();
        let session = TerminalSession {
            id: id.clone(),
            shell,
            pid,
            cols,
            rows,
        };
        self.insert(
            id.clone(),
            Session {
                master,
                writer,
                killer,
            },
        )?;

        let registry = self.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("luminosql-pty-{id}"))
            .spawn(move || pump(reader, child, sink, registry, id.clone()))
        {
            let mut orphan = self
                .remove(&session.id)
                .ok_or_else(|| "internal error: terminal vanished during spawn".to_string())?;
            let _ = orphan.killer.kill();
            return Err(format!("could not start the terminal reader thread: {e}"));
        }

        Ok(session)
    }

    /// Forward keystrokes / pasted bytes to the shell.
    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        self.with_session(id, |session| {
            session
                .writer
                .write_all(data.as_bytes())
                .and_then(|_| session.writer.flush())
                .map_err(|e| format!("could not write to terminal {id}: {e}"))
        })
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Err(format!(
                "terminal size must be at least 1x1, got {cols}x{rows}"
            ));
        }
        self.with_session(id, |session| {
            session
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("could not resize terminal {id}: {e}"))
        })
    }

    /// Kill the shell and forget the session. Idempotent: closing an unknown
    /// or already-exited id is a success, not an error.
    pub fn close(&self, id: &str) -> Result<(), String> {
        let Some(session) = self.remove(id) else {
            return Ok(());
        };
        let mut killer = session.killer;
        killer
            .kill()
            .map_err(|e| format!("could not terminate terminal {id}: {e}"))
    }
}

/// Drain the pty until the shell goes away, then reap it and announce the exit.
/// Holds no registry lock while reading or waiting — the reader owns its own
/// dup of the master fd and the child, so writes and kills keep working.
fn pump(
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn Child + Send + Sync>,
    sink: Arc<dyn EventSink>,
    registry: TerminalRegistry,
    id: String,
) {
    let mut buf = [0u8; 8192];
    loop {
        let n = match reader.read(&mut buf) {
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        if n == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buf[..n]);
        if !chunk.is_empty() {
            sink.data(&id, &chunk);
        }
    }
    // Release the reader end before blocking, so the shell sees the pty close.
    drop(reader);

    let code = child.wait().ok().map(|status| status.exit_code());
    sink.exit(&id, code);
    let _ = registry.remove(&id);
}

/// Where pump output goes. Abstracted so the registry can be exercised by plain
/// `cargo test` without booting a Tauri application.
pub trait EventSink: Send + Sync {
    fn data(&self, id: &str, data: &str);
    fn exit(&self, id: &str, code: Option<u32>);
}

struct TauriSink(AppHandle);

impl EventSink for TauriSink {
    fn data(&self, id: &str, data: &str) {
        let _ = self.0.emit(
            "terminal:data",
            serde_json::json!({ "id": id, "data": data }),
        );
    }

    fn exit(&self, id: &str, code: Option<u32>) {
        let _ = self.0.emit("terminal:exit", serde_json::json!({ "id": id, "code": code }));
    }
}

/// A live terminal, exactly as the frontend's `TerminalSession` expects it.
#[derive(Debug, Serialize)]
pub struct TerminalSession {
    pub id: String,
    pub shell: String,
    pub pid: u32,
    pub cols: u16,
    pub rows: u16,
}

/// The user's login shell, falling back to the platform default. Fails with a
/// readable message when the configured program cannot be used, instead of
/// silently spawning something else.
fn shell_program() -> Result<String, String> {
    #[cfg(unix)]
    let shell = env::var("SHELL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());
    #[cfg(windows)]
    let shell = env::var("COMSPEC")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "cmd.exe".to_string());

    let meta = Path::new(&shell)
        .metadata()
        .map_err(|_| format!("no usable shell found: {shell} does not exist on this machine"))?;
    if !meta.is_file() {
        return Err(format!("no usable shell found: {shell} is not a program file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return Err(format!("no usable shell found: {shell} is not executable"));
        }
    }
    Ok(shell)
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    cwd: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<TerminalSession, String> {
    let registry = state.terminals.clone();
    let sink: Arc<dyn EventSink> = Arc::new(TauriSink(app));
    run_blocking(move || registry.open(cwd, sink)).await
}

#[tauri::command]
pub async fn terminal_write(
    id: String,
    data: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let registry = state.terminals.clone();
    run_blocking(move || registry.write(&id, &data)).await
}

#[tauri::command]
pub async fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let registry = state.terminals.clone();
    run_blocking(move || registry.resize(&id, cols, rows)).await
}

#[tauri::command]
pub async fn terminal_close(
    id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let registry = state.terminals.clone();
    run_blocking(move || registry.close(&id)).await
}

/// Pty syscalls block (reads, `wait`, `kill`), so they run on the blocking
/// pool instead of a runtime worker thread.
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("terminal task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::time::{Duration, Instant};

    enum Ev {
        Data(String),
        Exit(Option<u32>),
    }

    struct Recorder(Sender<Ev>);

    impl EventSink for Recorder {
        fn data(&self, _id: &str, data: &str) {
            let _ = self.0.send(Ev::Data(data.to_string()));
        }
        fn exit(&self, _id: &str, code: Option<u32>) {
            let _ = self.0.send(Ev::Exit(code));
        }
    }

    fn recorder() -> (Arc<dyn EventSink>, Receiver<Ev>) {
        let (tx, rx) = mpsc::channel();
        (Arc::new(Recorder(tx)), rx)
    }

    #[test]
    fn default_size_is_80_by_24() {
        assert_eq!(default_size(), (80, 24));
        assert_eq!(DEFAULT_COLS, 80);
        assert_eq!(DEFAULT_ROWS, 24);
    }

    #[test]
    fn registry_starts_empty_and_closing_unknown_id_is_ok() {
        let registry = TerminalRegistry::new();
        assert!(registry.is_empty());
        assert_eq!(registry.len(), 0);
        assert!(registry.close("no-such-terminal").is_ok());
        assert!(registry.close("no-such-terminal").is_ok());
        assert!(registry.is_empty());
    }

    #[test]
    fn open_with_missing_cwd_is_an_error() {
        let registry = TerminalRegistry::new();
        let (sink, _rx) = recorder();
        let missing = env::temp_dir()
            .join("luminosql-terminal-does-not-exist-4f21")
            .display()
            .to_string();
        let err = registry
            .open(Some(missing), sink)
            .expect_err("a missing cwd must not spawn a shell");
        assert!(err.contains("working directory does not exist"), "{err}");
        assert!(registry.is_empty());
    }

    #[test]
    fn open_runs_a_real_shell_and_close_reaps_it() {
        let registry = TerminalRegistry::new();
        let (sink, rx) = recorder();
        let session = registry
            .open(None, sink)
            .expect("a shell should start in the test environment");

        assert!(!session.id.is_empty());
        assert!(!session.shell.is_empty());
        assert!(session.pid > 0, "the shell must report a pid");
        assert_eq!((session.cols, session.rows), default_size());
        assert_eq!(registry.len(), 1);

        // Keystrokes must reach the shell and the shell's OUTPUT must come back.
        //
        // The marker is deliberately split across two adjacent shell strings: a
        // pty echoes typed input, so a marker that also appears in the command
        // we type would be found in the echo and the test would pass without the
        // shell ever running anything. `echo LUMI""NQ` prints `LUMINQ`, which
        // never occurs in the bytes we wrote.
        registry
            .write(&session.id, "echo LUMI\"\"NQ\r")
            .expect("write should reach the pty");
        assert!(registry
            .resize(&session.id, 100, 30)
            .is_ok());
        assert!(registry.resize(&session.id, 0, 30).is_err());
        assert!(registry.write("no-such-terminal", "x").is_err());

        let deadline = Instant::now() + Duration::from_secs(20);
        let mut seen = String::new();
        while Instant::now() < deadline && !seen.contains("LUMINQ") {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ev::Data(chunk)) => seen.push_str(&chunk),
                Ok(Ev::Exit(code)) => panic!("shell exited early with {code:?}"),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => panic!("reader thread vanished"),
            }
        }
        assert!(
            seen.contains("LUMINQ"),
            "the shell never echoed back its own output, saw: {seen:?}"
        );

        registry.close(&session.id).expect("close should succeed");
        assert!(registry.is_empty());
        assert!(registry.close(&session.id).is_ok());

        let deadline = Instant::now() + Duration::from_secs(20);
        let mut exited = false;
        while Instant::now() < deadline && !exited {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ev::Data(_)) => {}
                Ok(Ev::Exit(_)) => exited = true,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => panic!("reader thread vanished"),
            }
        }
        assert!(exited, "closing a terminal must emit terminal:exit");
    }
}