// POST /api/ask { question, context } -> { answer, cites: [...] }
import { handle } from "../../lib/assistant.js";
export const onRequestPost = ctx => handle("ask", ctx);
