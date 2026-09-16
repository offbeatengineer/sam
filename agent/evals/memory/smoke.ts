import { ask, cost, f } from "./typesafe";

const r = await ask("I just moved to Berlin last month, still getting used to the winters.", {
  durable_fact: { type: "noul", instructions: "Does the speaker state a lasting fact about their own life?" },
});
console.log(r.model, r.answers, r.usage, `${f(r.ms, 0)}ms`, `$${cost(r).toFixed(7)}`);
