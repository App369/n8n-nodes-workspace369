# n8n-nodes-workspace369

n8n community nodes for [Workspace369](https://workspace369.com), the client management, invoicing and scheduling app for service businesses.

- **Workspace369 node**: create and search clients, search and read requests, list and read invoices, create calendar events.
- **Workspace369 Trigger node**: start a workflow the moment something happens, such as an invoice being paid or a new request arriving.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger events](#trigger-events) · [Compatibility](#compatibility) · [License](#license)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

In short: in n8n, go to **Settings → Community nodes → Install**, enter `n8n-nodes-workspace369`, accept the risk notice and install. On a self-hosted n8n you can also run `npm install n8n-nodes-workspace369` in your n8n custom folder.

## Credentials

1. In Workspace369, an admin turns on AI connections, then opens **Settings → AI connections → Personal access tokens** and creates a token. For instant triggers, also give the token the webhooks scope (`webhooks:manage`), and use an account that can manage webhooks; request (lead) events also need access to Requests.
2. In n8n, create a **Workspace369 API** credential and paste the token into **API Key (Personal Access Token)**.
3. Leave **Base URL** as `https://mcp.workspace369.com` unless support told you otherwise.

Good to know:

- The API is available on the **Specialist plan and up**. On a lower plan the credential test fails with a plan message.
- Every call uses **Tokens** from your workspace balance. When the balance is empty, calls fail until you top up.
- Some actions that send something to a client may **wait for approval in the app**. In that case the node still succeeds and its output has `held_for_approval: true` so your workflow can carry on.
- Rate limits apply per token and per workspace. n8n shows the API's own error message when you hit one.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Client | Create | Create a client or prospect. Name is required; everything else is under **Additional Fields** (email, phone, company, address, lifecycle stage, lead source, idempotency key and more). |
| Client | Search | Search by query, lead source, client type, stage or tags. **Return All** pages through every result; otherwise set a **Limit**. |
| Request | Search | Search requests by status, form or text. Supports **Return All** and **Limit**. |
| Request | Get | Get one request by ID. |
| Invoice | List | List invoices, filtered by text, status, client, number or archived. Supports **Return All** and **Limit**. |
| Invoice | Get | Get one invoice with its line items, by ID or invoice number. |
| Calendar Event | Create | Create an event. Title and start are required; end, all-day, time zone, client, category, reminders, recurrence and assignees are under **Additional Fields**. |

Output: search and list operations return one item per record. Create and get operations return the record itself. Empty fields are never sent to the API.

Errors show the API's own message. Turn on **Continue On Fail** to get an `error` field on the item instead of stopping the workflow.

### Create request

There is no "Create request" operation yet, because the Workspace369 API has no route for it. It will be added once the API offers one. Until then, use **Client → Create** with **Lifecycle Stage** set to **Prospect**, which adds the lead under Prospects.

## Trigger events

The **Workspace369 Trigger** node subscribes to the events you pick (you can pick several):

| Area | Events |
|---|---|
| Time | New time entry, Time entry updated, Time entry deleted |
| Timesheets | Timesheet submitted, Timesheet approved, Timesheet rejected |
| Invoices | New invoice, Invoice paid, Invoice status changed |
| Proposals | Proposal sent, Proposal accepted, Proposal declined |
| Contracts | Contract sent, Contract signer completed, Contract completed, Contract declined, Contract voided, Contract expired |
| Requests | New request (lead), Request converted, Request archived |

Request events need access to Requests in Workspace369. Each run receives the delivery envelope: `webhook_id`, `event_type`, `entity_id`, `workspace_id`, `subscription_id` and `data` (the event payload).

When you activate the workflow, n8n registers its webhook address with Workspace369. When you deactivate it, the registration is removed.

**n8n must be reachable at a public https URL.** Workspace369 refuses http, localhost and private addresses. On a self-hosted n8n, set the `WEBHOOK_URL` environment variable to your public https address (a tunnel works for testing).

### Instant triggers need the hooks API

The trigger uses the Workspace369 hooks API (`/v1/hooks`), which is rolling out. Until it is switched on for your workspace, activating the trigger shows "Instant triggers aren't switched on for Workspace369 yet." The action node does not depend on it.

### Signature verification

When the registration is created, Workspace369 returns a secret once. The node stores it in the workflow's static data and checks every delivery:

- `X-Webhook-Signature` must equal the hex HMAC-SHA256 of the raw request body followed by the `X-Webhook-Timestamp` value, keyed with the secret.
- The comparison is timing-safe. A mismatch is rejected with `401` and the workflow does not run.
- `X-Webhook-Timestamp` (epoch milliseconds) must be within 5 minutes of now, in either direction. Older, future or non-numeric timestamps are rejected with `401`. Each delivery attempt is signed again with a fresh timestamp, so retries still pass.
- If no secret is stored for the trigger, deliveries are rejected with `401`. Re-activate the workflow and the node registers a fresh hook with a new secret.

## Icon

The icon in this package is a neutral placeholder mark with the text "369". The official Workspace369 logo should replace `icons/workspace369.svg`, its `.dark.svg` twin and the copies in the two node folders before wider release.

## Compatibility

Built for n8n with `n8nNodesApiVersion` 1 and tested against `n8n-workflow` 2.44.1. It has no runtime dependencies and uses n8n's own HTTP helper. n8n itself runs on Node.js 20.19 through 24.x (see the n8n installation docs), so use a Node.js version in that range. The unit tests use mocks and have not been run inside a live n8n instance.

## Development

```
npm install
npm run lint
npm run build
npm test
```

## License

[MIT](LICENSE)
