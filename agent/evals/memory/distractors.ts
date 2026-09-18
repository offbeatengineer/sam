// The 250-memory store used by the scale experiments: the 60 labeled memories from
// data.ts with 190 templated distractors interleaved, so position carries no signal.
import { MEMORIES } from "./data";

const names = ["Aarav", "Bea", "Carlos", "Dmitri", "Elif", "Farah", "Goran", "Hana", "Ivo", "Jun", "Kofi", "Lena", "Musa", "Nils", "Olga"];
const teams = ["ledger", "risk", "onboarding", "payouts", "fraud", "data platform"];
const books = ["Dune", "Sapiens", "Snow Crash", "The Three-Body Problem", "Thinking in Systems", "Deep Work", "Piranesi", "The Mythical Man-Month", "Project Hail Mary", "Klara and the Sun"];
const services = ["ledger-api", "kyc-gateway", "fx-rates", "notifier", "statement-gen", "card-auth", "webhook-relay", "audit-log"];
const langs = ["Go", "Kotlin", "Rust", "Python", "Elixir"];
const cities = ["Lisbon", "Seoul", "Chengdu", "Munich", "Singapore", "Hanoi", "Oslo", "Taipei"];
const reasons = ["a conference", "a friend's wedding", "a team offsite", "a long weekend"];
const relatives = ["cousin", "uncle", "aunt", "college roommate", "former colleague"];
const jobs = ["architect", "nurse", "teacher", "pilot", "chef", "lawyer"];
const tools = ["Nx", "Deno", "Pulumi", "Temporal", "Bazel", "Turborepo", "Kafka Streams", "dbt", "Earthly", "Nomad"];
const subs = ["1Password", "Spotify", "iCloud+", "Notion", "Fastmail", "Strava", "Kagi", "Readwise", "Setapp", "Backblaze"];
const months = ["January", "March", "June", "August", "October"];

const pick = <T,>(xs: T[], i: number) => xs[i % xs.length];

export function distractors(): string[] {
  const filler: string[] = [];
  for (let i = 0; i < 30; i++) filler.push(`User's colleague ${pick(names, i)} ${"ABCDEFGHIJ"[i % 10]}. works on the ${pick(teams, i)} team at Northwind Pay.`);
  for (let i = 0; i < 30; i++) filler.push(`User read "${pick(books, i)}"${i >= 10 ? ` (${i >= 20 ? "third" : "second"} read)` : ""} in ${2019 + (i % 6)} and rated it ${3 + (i % 3)}/5.`);
  for (let i = 0; i < 30; i++) filler.push(`The ${pick(services, i)}${i >= 8 ? `-v${1 + (i >> 3)}` : ""} service at Northwind Pay is written in ${pick(langs, i)} and owned by ${pick(names, i + 3)}.`);
  for (let i = 0; i < 30; i++) filler.push(`User visited ${pick(cities, i)} in ${2017 + (i % 8)} for ${pick(reasons, i)}.`);
  for (let i = 0; i < 20; i++) filler.push(`User's ${pick(relatives, i)} ${pick(names, i + 7)} works as a ${pick(jobs, i)} in ${pick(cities, i + 2)}.`);
  for (let i = 0; i < 25; i++) filler.push(`User tried ${pick(tools, i)}${i >= 10 ? " again" : ""} in ${2020 + (i % 6)} and decided not to adopt it.`);
  for (let i = 0; i < 25; i++) filler.push(`User's ${pick(subs, i)} subscription${i >= 10 ? " (family plan)" : ""} renews every ${pick(months, i)}.`);
  return filler;
}

/** Real memories keep their M ids; distractors are F000..F189. */
export function scaleStore(): Record<string, string> {
  const filler = distractors();
  const real = Object.entries(MEMORIES);
  const store: Record<string, string> = {};
  let fi = 0;
  for (let i = 0; i < real.length; i++) {
    store[real[i][0]] = real[i][1];
    for (let k = 0; k < 3 && fi < filler.length; k++, fi++) store[`F${String(fi).padStart(3, "0")}`] = filler[fi];
  }
  while (fi < filler.length) { store[`F${String(fi).padStart(3, "0")}`] = filler[fi]; fi++; }
  return store;
}
