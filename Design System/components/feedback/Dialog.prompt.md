One-line: confirmation and short-form creation flows; positions itself against the nearest positioned ancestor.

```jsx
<Dialog open={open} onClose={close} title="Add property" subtitle="One snippet per site."
  footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary">Create</Button></>}>
  <Input label="Domain" mono placeholder="example.com" />
</Dialog>
```

Enters with a 6px rise + slight scale on --ease-emphasis. Give the parent `position:relative`.
