const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
} as const;

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function line(color: string, icon: string, scope: string, msg: string): void {
  console.log(`${COLORS.dim}[${ts()}]${COLORS.reset} ${color}${icon}${COLORS.reset} ${COLORS.bold}${scope}${COLORS.reset} ${msg}`);
}

export const log = {
  step(scope: string, msg: string): void {
    line(COLORS.cyan, "▸", scope, msg);
  },
  info(scope: string, msg: string): void {
    line(COLORS.dim, "·", scope, msg);
  },
  ok(scope: string, msg: string): void {
    line(COLORS.green, "✔", scope, msg);
  },
  warn(scope: string, msg: string): void {
    line(COLORS.yellow, "⚠", scope, msg);
  },
  error(scope: string, msg: string): void {
    line(COLORS.red, "✖", scope, msg);
  },
  agent(scope: string, msg: string): void {
    line(COLORS.magenta, "🤖", scope, msg);
  },
  banner(title: string): void {
    const bar = "─".repeat(Math.max(8, Math.min(70, title.length + 12)));
    console.log(`\n${COLORS.bold}${bar}\n  ${title}\n${bar}${COLORS.reset}`);
  },
};
