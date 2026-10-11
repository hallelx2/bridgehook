//! What the CLI prints: readable lines on a terminal, one JSON object per
//! line with `--json` (for scripts and agents). Colour only on a terminal,
//! and never when `NO_COLOR` is set.

use serde_json::{json, Value};
use std::io::{IsTerminal, Write};

#[derive(Clone, Copy)]
pub struct Out {
    pub json: bool,
    verbose: bool,
    color: bool,
}

impl Out {
    pub fn new(json: bool, verbose: bool) -> Self {
        let color =
            !json && std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
        Self {
            json,
            verbose,
            color,
        }
    }

    /// With `--verbose`: a timestamped line on stderr (in either mode, so
    /// `--json` stdout stays machine-readable).
    pub fn debug(&self, s: impl FnOnce() -> String) {
        if self.verbose {
            eprintln!("{} {}", chrono::Local::now().format("%H:%M:%S%.3f"), s());
        }
    }

    fn paint(&self, code: &str, s: &str) -> String {
        if self.color {
            format!("\x1b[{code}m{s}\x1b[0m")
        } else {
            s.to_string()
        }
    }

    pub fn green(&self, s: &str) -> String {
        self.paint("32", s)
    }
    pub fn red(&self, s: &str) -> String {
        self.paint("31", s)
    }
    pub fn yellow(&self, s: &str) -> String {
        self.paint("33", s)
    }
    pub fn dim(&self, s: &str) -> String {
        self.paint("2", s)
    }
    pub fn bold(&self, s: &str) -> String {
        self.paint("1", s)
    }

    /// A JSON line in `--json` mode, otherwise the human line.
    pub fn emit(&self, value: Value, human: impl FnOnce() -> String) {
        let mut stdout = std::io::stdout().lock();
        if self.json {
            let _ = writeln!(stdout, "{value}");
        } else {
            let _ = writeln!(stdout, "{}", human());
        }
        let _ = stdout.flush();
    }

    /// Notes for people (progress, hints). Go to stderr so `--json` stdout
    /// stays machine-readable.
    pub fn note(&self, s: &str) {
        if !self.json {
            eprintln!("{s}");
        }
    }

    pub fn error(&self, message: &str) {
        if self.json {
            println!("{}", json!({ "event": "error", "message": message }));
        } else {
            eprintln!("{} {message}", self.red("error:"));
        }
    }
}

/// Local wall-clock time, HH:MM:SS.
pub fn clock() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}
