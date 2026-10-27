import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleChat } from '../src/shared/server/chat.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await handleChat(req, res)
}
