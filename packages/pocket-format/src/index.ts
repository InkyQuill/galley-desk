export type {
  Anchor,
  Availability,
  Chapter,
  Edit,
  Manifest,
  Range,
  Resolution,
  Review,
  Signal,
  SignalType,
} from './documents';
export { decodeManifest, decodeReview, encodeManifest, encodeReview } from './documents';
export { makeAnchor, resolveAnchor } from './anchors';
export { classifyReview } from './availability';
export { discover } from './discovery';
export type { ChapterProposal, DiscoveryFile } from './discovery';
