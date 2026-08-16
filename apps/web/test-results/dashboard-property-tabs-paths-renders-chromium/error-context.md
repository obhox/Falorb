# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> property tabs >> /paths renders
- Location: e2e/dashboard.spec.ts:61:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { level: 1 })
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { level: 1 })
  - Target page, context or browser has been closed

```

```yaml
- main:
  - text: Falorb Self-hosted analytics
  - heading "Sign in" [level=2]
  - text: Every property on one page. Email
  - img
  - textbox "Email":
    - /placeholder: you@example.com
  - text: Password
  - img
  - textbox "Password":
    - /placeholder: ••••••••••
  - button "Sign in"
  - paragraph:
    - text: No account yet?
    - link "Create one":
      - /url: /sign-up
- alert
```

```
Error: browserContext.close: Target page, context or browser has been closed
```