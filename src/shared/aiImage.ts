import { z } from 'zod'

// A pasted image travels as one inline JPEG/PNG/WebP data URL next to the prompt.
// The browser re-encodes it to fit this budget, and the server allows exactly this
// much on top of AI_MAX_BODY_BYTES, so diagram context keeps its own allowance.
export const MAX_AI_IMAGE_DATA_URL_BYTES = 200 * 1024
// Vision models bill images by tile, not by base64 size. 1500 tokens bounds a
// 1024px high-detail image with headroom; reported usage settles the real cost.
export const AI_IMAGE_INPUT_TOKEN_BOUND = 1500
export const AI_IMAGE_ONLY_PROMPT = 'Create a diagram from this image.'

export const AiImageDataUrlSchema = z.string()
  .max(MAX_AI_IMAGE_DATA_URL_BYTES)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
