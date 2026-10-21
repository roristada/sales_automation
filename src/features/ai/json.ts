/** Parses a structured-output reply; models sometimes wrap JSON in a ``` fence anyway. */
export function parseJsonReply(text: string): unknown {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
