export interface AzureIconIndex {
  description: string
  count: number
  icons: { id: string; name: string; category: string; path: string }[]
}

export const OUTPUT_FILE: string
export function iconNameFromFile(fileName: string): string
export function slugifyIconName(name: string): string
export function buildIconIndex(): AzureIconIndex
export function serializeIconIndex(index: AzureIconIndex): string
