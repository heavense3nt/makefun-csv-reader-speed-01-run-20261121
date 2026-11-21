// main.ts — the program the harness runs: `node /bot/main.ts` (Node 22).
//
// It reads every case from /input/cases.json (a JSON array of {id, input}),
// answers each one alone with run() from solve.js, and writes
// /output/answers.json: a JSON array of the answers, one per case and in
// the cases' order. Outside a container MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it (the rules let an entry tune V8's flags this way).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

/** The directory the cases live in, and the one the answers go to. */
function dirs(): { input: string; output: string } {
  return {
    input: process.env.MAKEFUN_INPUT_DIR ?? '/input',
    output: process.env.MAKEFUN_OUTPUT_DIR ?? '/output',
  };
}

/** Every case of cases.json, in order. */
function loadCases(dir: string): { id: string; input: unknown }[] {
  return JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')) as {
    id: string;
    input: unknown;
  }[];
}

/** One answer per case, in the cases' order. */
function answerAll(cases: { id: string; input: unknown }[]): unknown[] {
  const answers: unknown[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i]!.input);
  return answers;
}

/** The answers, as one JSON array. */
function writeAnswers(dir: string, answers: unknown[]): void {
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers));
}

const { input, output } = dirs();
writeAnswers(output, answerAll(loadCases(input)));
