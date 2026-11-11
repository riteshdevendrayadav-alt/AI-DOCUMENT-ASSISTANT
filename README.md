# AI Document Question Answering Chatbot

A local-first academic document assistant for exploring a controlled collection of research sources. Papertrail demonstrates a retrieval-augmented question flow with source citations, document previews, and a responsible-AI evaluation workspace.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Included

- Ask questions across the sample academic collection.
- Plan up to three sub-questions, retrieve evidence per task, retry weak searches once, and leave unsupported parts unanswered.
- Show a step trace, source citations, and claim-level text-overlap checks for every answer.
- Add PDF, TXT, Markdown, and CSV files. PDF text extraction is loaded on demand; files are parsed in the browser.
- Inspect indexed documents and source previews in the library.
- Compare a pasted or generated answer against an indexed source and inspect possible demographic overgeneralization wording cues.

## Demo boundary

This version uses local keyword-overlap retrieval and a deterministic answer template. It does not call a foundation model, vector database, or remote service. Factuality review measures lexical overlap only; it cannot establish truth, detect contradictions reliably, or handle paraphrases robustly. Bias review flags only selected group terms combined with sweeping language; it is not a fairness or impact assessment. Both require human review. Production evaluation metrics require a model, retrieval backend, and labeled test set. Uploaded documents remain in browser memory and are not persisted after refresh.

## Production extension points

Connect document parsing and chunking to a persistent index, replace keyword ranking with embedding-based retrieval, and route grounded passages through a selected foundation model. Keep source IDs and passage metadata in the model context, enforce abstention and access controls server-side, and evaluate retrieval precision, answer faithfulness, relevance, privacy, and subgroup performance before release.
