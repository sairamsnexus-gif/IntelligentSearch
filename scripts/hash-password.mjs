#!/usr/bin/env node
/**
 * Produce NEXUS_OPERATOR_PASSWORD_HASH for hosted (no-database) mode.
 *   npm run hash-password            (prompts, input hidden)
 *   echo -n 'secret' | npm run hash-password -- --stdin
 * Prints only the scrypt hash; the password itself is never written anywhere.
 */
import { randomBytes, scryptSync } from "node:crypto";
import readline from "node:readline";

function hash(pw) {
  if (pw.length < 12) throw new Error("Use at least 12 characters");
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}

async function readStdin() {
  let s = "";
  for await (const c of process.stdin) s += c;
  return s.replace(/\r?\n$/, "");
}

async function prompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  rl._writeToOutput = (s) => { if (!s.includes("\n") && s.length > 1) rl.output.write(s); };
  const pw = await new Promise((r) => rl.question("Operator password: ", r));
  rl.close();
  process.stderr.write("\n");
  return pw;
}

const pw = process.argv.includes("--stdin") || !process.stdin.isTTY ? await readStdin() : await prompt();
try {
  process.stdout.write(`${hash(pw)}\n`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
