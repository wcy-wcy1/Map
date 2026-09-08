import type { PlaceGroup } from '../domain/map-layout'

/** The image viewBox is 80 × 72, with the true coordinate at (40, 68). */
export function markerDimensions(zoom: number) {
  const width = zoom < 8 ? 54 : zoom < 11 ? 58 : 64
  return { width, height: width * 0.9, anchorX: width / 2, anchorY: width * 0.85 }
}

export function markerLabel(group: PlaceGroup, visited: ReadonlySet<string>, picking: boolean): string {
  if (picking) return `将${group.anchor.name}的位置用于我的地点`
  const visitedCount = group.members.filter(member => visited.has(member.id)).length
  return group.members.length > 1
    ? `${group.anchor.name}附近 ${group.members.length} 个景点，点击展开${visitedCount ? '，其中 ' + visitedCount + ' 处已记录' : ''}`
    : `查看${group.anchor.name}${visitedCount ? '，已记录' : ''}`
}

/** A previously focused marker can become a member of a different cluster. */
export function focusAnchor(groups: readonly PlaceGroup[], previousId: string): string | undefined {
  return groups.find(group => group.members.some(place => place.id === previousId))?.anchor.id
}
