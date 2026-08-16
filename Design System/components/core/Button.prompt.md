One-line: the standard Falorb action control — use `secondary` by default, `primary` for the single confirming action, `accent` only for a marketing/CTA moment.

```jsx
<Button variant="primary" size="md" iconLeft={<Icon name="plus" />}>Add property</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

Variants: primary (white on graphite), secondary (hairline glass-lite, the workhorse), glass (over charts/imagery), ghost (toolbars, table row actions), accent (glacier — max one per screen), danger (dim red wash, never solid red). Press state is a 0.5px settle, not a bounce.
