import { EmptyState, Icon } from "@falorb/ui";

/**
 * Empty states name the cause and the remedy.
 *
 * "No data available" tells a reader nothing they cannot already see. Every
 * caller here passes what was looked for and what to change, per the design
 * system's content rule.
 */
export function Empty({
  icon = "search-x",
  title,
  body,
  action,
  dense = false,
}: {
  icon?: string;
  title: string;
  body: string;
  action?: React.ReactNode;
  dense?: boolean;
}) {
  return (
    <EmptyState
      icon={<Icon name={icon} size={16} />}
      title={title}
      body={body}
      action={action}
      dense={dense}
    />
  );
}

