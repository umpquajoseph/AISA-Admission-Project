// POST /api/draft { message, context } -> { changes: [...], note }
import { handle } from "../../lib/assistant.js";
export const onRequestPost = ctx => handle("draft", ctx);
