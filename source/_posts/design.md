---
title: Mermaid Test
---

```mermaid
flowchart TD

StaticPage -->|GithubPages| User
MarkdownPost -->|Server Render| StaticPostPage
MarkdownComment -->|Server Render| StaticCommentJson
StaticCommentJson -->|GithubPages| User
StaticPostPage -->|GithubPages| User
```

```mermaid
flowchart TD
Sender --> Outlook
Sender -->|CloudflareEmailWorker| CloudflareWorker
Outlook -->|HTTP webhook| CloudflareWorker
CloudflareWorker -->|Post| GithubAction
CloudflareWorker -->|Reply| GithubAPI
GithubAction -->|Complete Render| Content
GithubAPI -->|Direct Commit| Content

Sender --> SelfHost -->|Direct Commit| Content
Outlook -->|API| SelfHost
```

# Article Titles