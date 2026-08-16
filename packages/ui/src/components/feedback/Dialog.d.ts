import * as React from "react";

/**
 * Glass modal over a blurred scrim.
 * @startingPoint section="Feedback" subtitle="Dialog, Tooltip, EmptyState" viewport="700x300"
 */
export interface DialogProps {
  open?: boolean;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  /** Right-aligned action row. */
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  style?: React.CSSProperties;
}
export declare function Dialog(props: DialogProps): React.JSX.Element;
