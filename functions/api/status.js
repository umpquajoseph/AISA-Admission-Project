// GET /api/status -> { connected, model }: lets the screens say "not connected" before a click
import { status } from "../../lib/assistant.js";
export const onRequestGet = ({ env }) => status(env);
