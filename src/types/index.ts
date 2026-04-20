/**
 * @spatial/types — All shared type declarations.
 * No runtime code except branded type constructors and theme defaults.
 */

// Primitives
export type {
  Pixels,
  Timestamp,
  NodeId,
  FrameId,
  FontDescriptor,
  Rect,
  EdgeInsets,
} from './primitives';
export { px, nodeId, frameId, timestamp, font } from './primitives';

// Tokens
export type {
  SpatialTagName,
  SpatialToken,
  TagOpenToken,
  TagCloseToken,
  TextToken,
  NewlineToken,
  EOFToken,
  TokenizerState,
} from './tokens';

// AST
export type {
  NodeStatus,
  DirtyFlags,
  NodeBase,
  TextBuffer,
  SlideProps,
  AutoGridProps,
  StackProps,
  ColumnsProps,
  CanvasProps,
  MetricCardProps,
  CodeBlockProps,
  DataTableProps,
  ChartProps,
  QuoteProps,
  CalloutProps,
  TextProps,
  HeadingProps,
  SpacerProps,
  DividerProps,
  ImageProps,
  SpatialNode,
  LayoutContainerKind,
  ContentComponentKind,
  PrimitiveKind,
  NodeKind,
  SpatialDocument,
} from './ast';

// Delta
export type {
  ASTDelta,
  NodeAddedDelta,
  NodeClosedDelta,
  TextAppendedDelta,
  NodeRemovedDelta,
} from './delta';

// Layout
export type {
  LayoutConstraint,
  MeasurementResult,
  HeightOnlyMeasurement,
  LineDetailMeasurement,
  LayoutBox,
} from './layout';

// Render
export type {
  RenderCommand,
  FillRectCommand,
  StrokeRectCommand,
  FillTextCommand,
  DrawImageCommand,
  ClipRectCommand,
  RestoreClipCommand,
  DrawLineCommand,
} from './render';

// Stream
export type {
  StreamToken,
  UpstreamMessage,
  DownstreamMessage,
  StreamChunkMessage,
  StreamEndMessage,
  StreamErrorMessage,
  ConfigUpdateMessage,
  PingMessage,
  BackpressurePauseMessage,
  BackpressureResumeMessage,
  AckMessage,
  PongMessage,
} from './stream';
export { PROTOCOL_VERSION } from './stream';

// Theme
export type { ThemeConfig } from './theme';
export { defaultTheme, darkTheme } from './theme';

// Layout Constants
export {
  METRIC_VALUE_FONT,
  METRIC_DELTA_FONT,
  METRIC_VALUE_LINE_HEIGHT,
  METRIC_DELTA_LINE_HEIGHT,
  METRIC_VALUE_DELTA_GAP,
  CALLOUT_TITLE_FONT,
  CALLOUT_TITLE_LINE_HEIGHT,
} from './layout-constants';
