/** Only the user's explicit public selection enters the PNG renderer. */
export interface MemoryCardInput {
  placeId: string
  date?: string
  showDate?: boolean
  text: string
  photos: { id: string; url: string }[]
  landmarkUrl?: string | null
}
export interface MemoryCardResult {
  blob: Blob
  width: number
  height: number
  filename: string
}
export type RenderMemoryCard = (input: MemoryCardInput) => Promise<MemoryCardResult>
export interface CardCatalogue {
  has(id: string): boolean
  get(id: string): { name: string } | undefined
}
