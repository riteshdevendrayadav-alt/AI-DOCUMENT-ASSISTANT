import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp,
  Clipboard, Clock3, FileText, FlaskConical, FolderOpen, Gauge, Library,
  MessageSquareText, MoreHorizontal, Plus, Search, Settings2, ShieldCheck,
  Sparkles, Upload, X,
} from 'lucide-react';
import './styles.css';

const starterDocuments = [
  {
    id: 'doc-1',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    authors: 'Lewis et al. · NeurIPS 2020',
    type: 'PDF',
    pages: 12,
    color: 'mint',
    text: 'Retrieval-augmented generation (RAG) combines a parametric memory, a pretrained sequence-to-sequence model, with a non-parametric memory, a dense vector index of Wikipedia. The model retrieves documents using a neural retriever and conditions generation on retrieved passages. RAG models generate more specific, diverse, and factual language than a parametric-only baseline. The approach is evaluated on open-domain question answering and knowledge-intensive tasks. Retrieval can be treated as a latent variable, and retrieved documents provide provenance for generated answers.',
  },
  {
    id: 'doc-2',
    title: 'Lost in the Middle: How Language Models Use Long Contexts',
    authors: 'Liu et al. · TACL 2024',
    type: 'PDF',
    pages: 24,
    color: 'blue',
    text: 'Language models often exhibit a U-shaped performance curve: they use information at the beginning and end of an input context more effectively than information in the middle. This effect appears across model sizes and context lengths. Performance can degrade substantially when relevant information is placed in the middle of long contexts. The experiments suggest that simply increasing the context window does not guarantee effective use of all available information. Careful retrieval and input ordering can improve performance.',
  },
  {
    id: 'doc-3',
    title: 'On the Dangers of Stochastic Parrots: Can Language Models Be Too Big?',
    authors: 'Bender et al. · FAccT 2021',
    type: 'PDF',
    pages: 14,
    color: 'peach',
    text: 'Large language models can reproduce biases and harms encoded in training data. The paper highlights environmental costs, the risk of homogenized perspectives, and the difficulty of documenting training data. It recommends careful curation, documentation, and evaluation across affected communities. Fluency should not be confused with understanding or factuality. Dataset documentation and model cards can help communicate intended uses, limitations, and risks.',
  },
];

const suggestedQuestions = [
  'How does RAG improve factuality?',
  'What are the limits of long context windows?',
  'Which risks should we evaluate before deployment?',
];

const initialMessages = [
  {
    id: 'welcome',
    role: 'assistant',
    text: 'Hi, I’m your research assistant. Ask a question about the documents in this workspace and I’ll retrieve relevant passages, then show exactly where the answer came from.',
    sources: [],
  },
];

const retrievalStopWords = new Set(['about', 'after', 'also', 'does', 'from', 'have', 'into', 'that', 'their', 'them', 'there', 'these', 'they', 'this', 'those', 'through', 'using', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your']);
const groupMarkers = /\b(women|woman|men|man|female|male|gender|race|racial|ethnicity|ethnic|religion|religious|disability|disabled|immigrant|immigrants|nationality|older adults|young people|socioeconomic)\b/i;
const sweepingLanguage = /\b(all|always|never|none|every|inherently|naturally|cannot|can't)\b/i;

function tokenize(value) {
  return value.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? [];
}

function queryTerms(question) {
  return [...new Set(tokenize(question).filter((term) => !retrievalStopWords.has(term)))];
}

function planQuery(question) {
  const taskPattern = /[?;\n]+|\b(?:and also|also|additionally)\s+(?=(?:what|which|how|why|when|where|compare|list|explain|describe|summarize)\b)|\band\s+(?=(?:what|which|how|why|when|where|compare|list|explain|describe|summarize)\b)/i;
  const subtasks = question.split(taskPattern).map((task) => task.replace(/^[\s,.:;]+|[\s,.:;]+$/g, '').trim()).filter(Boolean).slice(0, 3);
  return { subtasks: subtasks.length ? subtasks : [question], isComplex: subtasks.length > 1 || queryTerms(question).length > 20 };
}

function retrieve(question, documents, minimumMatches = 1) {
  const terms = queryTerms(question);
  return documents
    .map((document) => {
      const sentences = document.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [document.text];
      const passages = [];
      for (let index = 0; index < sentences.length; index += 2) {
        passages.push(sentences.slice(index, index + 2).join(' ').trim());
      }
      const rankedPassages = passages.map((excerpt) => {
        const words = tokenize(excerpt);
        const counts = new Map();
        words.forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
        const matched = terms.filter((term) => counts.has(term));
        const score = matched.reduce((sum, term) => sum + Math.min(counts.get(term), 3), 0);
        return { document, score, matched, excerpt };
      });
      return rankedPassages.sort((a, b) => b.score - a.score)[0];
    })
    .filter((result) => result?.score > 0 && result.matched.length >= minimumMatches)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function evaluateGrounding(claims) {
  const checked = claims.map((claim) => {
    const claimWords = new Set(queryTerms(claim.text));
    const evidenceWords = new Set(queryTerms(claim.evidence));
    const supportedWords = [...claimWords].filter((word) => evidenceWords.has(word)).length;
    const support = claimWords.size ? supportedWords / claimWords.size : 0;
    return { ...claim, support, status: support >= 0.8 ? 'supported' : support >= 0.5 ? 'review' : 'unsupported' };
  });
  const supported = checked.filter((claim) => claim.status === 'supported').length;
  return {
    claims: checked,
    supported,
    total: checked.length,
    supportRate: checked.length ? supported / checked.length : null,
    averageOverlap: checked.length ? checked.reduce((sum, claim) => sum + claim.support, 0) / checked.length : null,
  };
}

function detectBiasSignals(text) {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => groupMarkers.test(sentence) && sweepingLanguage.test(sentence));
}

async function runAgenticQuery(question, documents, setPhase) {
  const plan = planQuery(question);
  setPhase('Analyzing query');
  await new Promise((resolve) => window.setTimeout(resolve, 120));

  setPhase(`Retrieving ${plan.subtasks.length} ${plan.subtasks.length === 1 ? 'task' : 'subtasks'}`);
  const taskResults = plan.subtasks.map((task) => {
    const requiredMatches = queryTerms(task).length > 2 ? 2 : 1;
    return { task, results: retrieve(task, documents, requiredMatches) };
  });

  const unresolved = taskResults.filter((item) => !item.results.length);
  let revisedTasks = [];
  if (unresolved.length) {
    setPhase('Refining searches with weak evidence');
    revisedTasks = unresolved.map((item) => ({ ...item, results: retrieve(item.task, documents, 1) }));
  }
  const revisedByTask = new Map(revisedTasks.map((item) => [item.task, item.results]));
  const resolvedTasks = taskResults.map((item) => ({
    ...item,
    results: item.results.length ? item.results : (revisedByTask.get(item.task) ?? []),
    revised: !item.results.length && (revisedByTask.get(item.task)?.length ?? 0) > 0,
  }));
  const missingTasks = resolvedTasks.filter((item) => !item.results.length).map((item) => item.task);
  const results = plan.isComplex
    ? resolvedTasks.filter((item) => item.results.length).map((item) => ({ ...item.results[0], task: item.task }))
    : (resolvedTasks[0]?.results ?? []).map((result) => ({ ...result, task: question }));

  setPhase('Checking answer against cited evidence');
  const claims = results.slice(0, plan.isComplex ? undefined : 2).map((result) => ({
    text: result.excerpt,
    evidence: result.document.text,
    source: result.document.title,
    task: result.task,
  }));
  const grounding = evaluateGrounding(claims);
  const draftAnswer = answerFrom(results, plan, missingTasks);
  const biasSignals = detectBiasSignals(draftAnswer);
  const trace = [
    `Plan: ${plan.subtasks.length} task${plan.subtasks.length === 1 ? '' : 's'} identified${plan.isComplex ? ' for a multi-part query' : ''}.`,
    `Retrieve: relevant passages found for ${resolvedTasks.length - missingTasks.length} of ${resolvedTasks.length} task${resolvedTasks.length === 1 ? '' : 's'}.`,
    ...(revisedTasks.length ? [`Refine: retried ${revisedTasks.length} task${revisedTasks.length === 1 ? '' : 's'} with a broader match threshold.`] : []),
    `Verify: ${grounding.total} answer claim${grounding.total === 1 ? '' : 's'} checked against cited source text.`,
    `Review: ${biasSignals.length ? `${biasSignals.length} possible overgeneralization signal${biasSignals.length === 1 ? '' : 's'} flagged for human review.` : 'no group-generalization signal detected by the local heuristic.'}`,
  ];
  return { plan, results, missingTasks, grounding, biasSignals, trace, answer: draftAnswer };
}

function answerFrom(results, plan, missingTasks = []) {
  if (!results.length) {
    return 'I couldn’t find a relevant passage in the indexed documents. Try rephrasing the question or add a document that covers this topic. I won’t guess when the collection doesn’t support an answer.';
  }
  if (plan.isComplex) {
    const answered = results.map((result) => `${result.task}: ${result.excerpt}`);
    if (missingTasks.length) answered.push(`No supporting passage found for: ${missingTasks.join('; ')}.`);
    return `${answered.join('\n\n')}\n\nCheck the cited sources for context; unsupported parts are left unanswered.`;
  }
  const lead = results[0].excerpt;
  const corroboration = results.length > 1
    ? ` A related source adds that ${results[1].excerpt.charAt(0).toLowerCase()}${results[1].excerpt.slice(1)}`
    : '';
  return `${lead}${corroboration} The answer is grounded in the passages below; check the cited sources for the full context.`;
}

async function extractText(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    return { text: pages.join('\n'), pages: pdf.numPages };
  }
  return { text: await file.text(), pages: null };
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const [documents, setDocuments] = useState(starterDocuments);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [activeView, setActiveView] = useState('chat');
  const [busy, setBusy] = useState(false);
  const [agentPhase, setAgentPhase] = useState('');
  const [selectedSource, setSelectedSource] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  async function addFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setUploading(true);
    setNotice('');
    const supported = files.filter((file) => /\.(pdf|txt|md|csv)$/i.test(file.name));
    if (supported.length !== files.length) setNotice('Some files were skipped. Use PDF, TXT, Markdown, or CSV.');
    try {
      const imported = await Promise.all(supported.map(async (file) => {
        const { text, pages } = await extractText(file);
        if (!text.trim()) throw new Error(`${file.name} contains no extractable text.`);
        return {
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: file.name.replace(/\.[^.]+$/, ''),
          authors: `${formatBytes(file.size)} · Added just now`,
          type: file.name.split('.').pop().toUpperCase(),
          pages: pages ?? Math.max(1, text.split(/\n\s*\n/).length),
          color: ['mint', 'blue', 'peach'][documents.length % 3],
          text,
        };
      }));
      setDocuments((current) => [...imported, ...current]);
      setNotice(`${imported.length} document${imported.length === 1 ? '' : 's'} indexed and ready for questions.`);
      setActiveView('library');
    } catch (error) {
      setNotice(error.message || 'A file could not be read. Try another document.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submitQuestion(question = input) {
    const prompt = question.trim();
    if (!prompt || busy) return;
    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: prompt };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setBusy(true);
    setAgentPhase('Analyzing query');
    try {
      const result = await runAgenticQuery(prompt, documents, setAgentPhase);
      setMessages((current) => [...current, {
        id: `answer-${Date.now()}`,
        role: 'assistant',
        question: prompt,
        text: result.answer,
        sources: result.results,
        agentTrace: result.trace,
        evaluation: {
          grounding: result.grounding,
          biasSignals: result.biasSignals,
          missingTasks: result.missingTasks,
          plan: result.plan,
        },
      }]);
    } finally {
      setBusy(false);
      setAgentPhase('');
    }
  }

  function newChat() {
    setMessages(initialMessages);
    setSelectedSource(null);
    setActiveView('chat');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function removeDocument(id) {
    setDocuments((current) => current.filter((document) => document.id !== id));
    setNotice('Document removed from this workspace.');
  }

  const lastAnswer = [...messages].reverse().find((message) => message.role === 'assistant' && message.sources?.length);
  const indexedPages = documents.reduce((sum, document) => sum + (document.pages ?? 1), 0);

  return (
    <div className="app-shell" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><BookOpen size={19} strokeWidth={2.2} /></div>
          <span>papertrail<span className="brand-period">.</span></span>
        </div>

        <button className="workspace-switcher" onClick={() => setActiveView('chat')}>
          <span className="workspace-avatar">R</span>
          <span className="workspace-label"><strong>Research workspace</strong><small>Personal collection</small></span>
          <ChevronDown size={15} />
        </button>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={activeView === 'chat' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('chat')}>
            <MessageSquareText size={17} /><span>Ask questions</span><span className="nav-shortcut">⌘ K</span>
          </button>
          <button className={activeView === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('library')}>
            <Library size={17} /><span>Document library</span><span className="nav-count">{documents.length}</span>
          </button>
          <button className={activeView === 'evaluation' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('evaluation')}>
            <Gauge size={17} /><span>Evaluation</span>
          </button>
        </nav>

        <div className="sidebar-section-row"><span className="sidebar-section-label">YOUR SOURCES</span><button aria-label="Add document" className="icon-button quiet" onClick={() => fileRef.current?.click()}><Plus size={16} /></button></div>
        <div className="source-list">
          {documents.slice(0, 5).map((document) => (
            <button key={document.id} className="sidebar-source" onClick={() => { setSelectedSource(document); setActiveView('library'); }}>
              <span className={`mini-file ${document.color}`}><FileText size={13} /></span>
              <span>{document.title}</span>
            </button>
          ))}
          {documents.length > 5 && <div className="more-sources">+ {documents.length - 5} more sources</div>}
          {!documents.length && <div className="empty-sidebar">Add documents to get started.</div>}
        </div>

        <div className="sidebar-bottom">
          <div className="plan-note"><div className="plan-icon"><Sparkles size={15} /></div><div><strong>Local demo mode</strong><span>Answers stay in this browser</span></div></div>
          <button className="profile-row" onClick={() => setActiveView('evaluation')}><span className="profile-avatar">A</span><span><strong>Alex Morgan</strong><small>Researcher</small></span><MoreHorizontal size={17} /></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Research workspace</span><ChevronRight size={14} /><strong>{activeView === 'chat' ? 'Ask questions' : activeView === 'library' ? 'Document library' : 'Evaluation'}</strong></div>
          <div className="topbar-actions"><div className="engine-status"><span className="status-dot" />Local retrieval active</div><button className="icon-button top-help" aria-label="About this demo" title="About this demo" onClick={() => setNotice('Prototype mode: answers use local keyword retrieval and do not call a foundation model.') }><CircleHelp size={17} /></button></div>
        </header>

        {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}

        {activeView === 'chat' && (
          <div className="chat-layout">
            <section className="conversation-column">
              <div className="conversation-heading">
                <div><div className="eyebrow"><span className="eyebrow-line" />ACADEMIC DOCUMENT ASSISTANT</div><h1>Ask your library<span className="heading-period">.</span></h1><p>Answers grounded in your documents, with sources attached.</p></div>
                <button className="new-chat-button" onClick={newChat}><Plus size={16} />New chat</button>
              </div>

              <div className="message-list">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={message.id}>
                    {message.role === 'assistant' && <div className="assistant-avatar"><Sparkles size={16} /></div>}
                    <div className="message-body">
                      {message.role === 'user' && <div className="message-author user-author">You <span>Just now</span></div>}
                      {message.role === 'assistant' && index > 0 && <div className="message-author">Papertrail <span><Check size={12} /> Grounded answer</span></div>}
                      <p>{message.text}</p>
                      {!!message.sources?.length && <div className="answer-sources"><div className="answer-source-label"><span>Sources</span><span>{message.sources.length} passages retrieved</span></div><div className="citation-list">{message.sources.map((source, sourceIndex) => <button key={source.document.id} className="citation" onClick={() => setSelectedSource(source.document)}><span className={`citation-number ${source.document.color}`}>{sourceIndex + 1}</span><span className="citation-title">{source.document.title}</span><ChevronRight size={14} /></button>)}</div></div>}
                      {message.agentTrace?.length > 0 && <details className="agent-trace"><summary><Sparkles size={13} /> Agent loop · {message.agentTrace.length} checks</summary><ol>{message.agentTrace.map((step) => <li key={step}>{step}</li>)}</ol><div className="trace-caution">Local heuristics only. Review the cited passages and any flagged language.</div></details>}
                      {message.role === 'assistant' && index > 0 && <div className="answer-feedback"><span><ShieldCheck size={14} /> Check citations before relying on an answer.</span><button aria-label="Copy answer" title="Copy answer" onClick={() => { navigator.clipboard?.writeText(message.text); setNotice('Answer copied to clipboard.'); }}><Clipboard size={14} /></button><button aria-label="Helpful" title="Helpful" onClick={() => setNotice('Thanks. Feedback recorded for this demo session.')}><ArrowUp size={14} /></button><button aria-label="Not helpful" title="Not helpful" onClick={() => setNotice('Thanks. Feedback recorded for this demo session.')}><ArrowDown size={14} /></button></div>}
                    </div>
                  </article>
                ))}
                {busy && <div className="thinking-row"><div className="assistant-avatar"><Sparkles size={16} /></div><div className="thinking-content"><div className="thinking-title">{agentPhase}<span className="typing-dots"><i /><i /><i /></span></div><div className="agent-steps"><span className={agentPhase.includes('Analyzing') ? 'step-active' : 'step-done'}><Check size={11} /> Plan tasks</span><span className={agentPhase.includes('Retrieving') || agentPhase.includes('Refining') ? 'step-active' : agentPhase.includes('Checking') ? 'step-done' : ''}><Search size={11} /> Retrieve evidence</span><span className={agentPhase.includes('Checking') ? 'step-active' : ''}><ShieldCheck size={11} /> Check support</span></div></div></div>}
                <div ref={endRef} />
              </div>

              {messages.length === 1 && <div className="suggestion-block"><div className="suggestion-heading"><Sparkles size={14} /> Start with a question</div><div className="suggestion-list">{suggestedQuestions.map((question) => <button key={question} onClick={() => submitQuestion(question)}>{question}<ArrowUp size={14} /></button>)}</div></div>}

              <div className="composer-wrap">
                <form className="composer" onSubmit={(event) => { event.preventDefault(); submitQuestion(); }}>
                  <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitQuestion(); } }} placeholder="Ask a question about your documents..." rows="1" aria-label="Ask a question about your documents" />
                  <div className="composer-footer"><span><Search size={13} /> {documents.length} sources · {indexedPages} pages indexed</span><button type="submit" className="send-button" disabled={!input.trim() || busy} aria-label="Send question"><ArrowUp size={17} /></button></div>
                </form>
                <div className="composer-disclaimer">Local retrieval demo · Answers may be incomplete. Verify with the original source.</div>
              </div>
            </section>

            <aside className="context-panel">
              <div className="panel-heading"><div><span className="panel-eyebrow">RETRIEVAL CONTEXT</span><h2>In this workspace</h2></div><button className="icon-button quiet" aria-label="Workspace settings" title="Workspace settings" onClick={() => setActiveView('evaluation')}><Settings2 size={16} /></button></div>
              <div className="context-metrics"><div><span>Documents</span><strong>{documents.length}</strong></div><div><span>Pages indexed</span><strong>{indexedPages}</strong></div></div>
              <div className="context-divider" />
              <div className="context-section-title">{lastAnswer ? 'LAST RETRIEVAL' : 'RECENTLY ADDED'}<button onClick={() => setActiveView('library')}>View all <ChevronRight size={13} /></button></div>
              {lastAnswer?.sources?.length ? lastAnswer.sources.map((source, index) => <button className="retrieved-source" key={source.document.id} onClick={() => setSelectedSource(source.document)}><div className="retrieved-source-top"><span className={`mini-file ${source.document.color}`}><FileText size={13} /></span><span className="retrieval-score">{Math.min(98, 91 - index * 13)}% match</span></div><strong>{source.document.title}</strong><p>“{source.excerpt}”</p></button>) : documents.slice(0, 3).map((document) => <button className="recent-document" key={document.id} onClick={() => setSelectedSource(document)}><span className={`mini-file ${document.color}`}><FileText size={13} /></span><span><strong>{document.title}</strong><small>{document.authors}</small></span><ChevronRight size={14} /></button>)}
              {!documents.length && <div className="context-empty"><FolderOpen size={20} /><span>No documents yet</span></div>}
              <button className="upload-zone" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={16} /><span>{uploading ? 'Indexing document…' : 'Add documents'}</span><small>PDF, TXT, MD, CSV</small></button>
              <div className="responsible-note"><ShieldCheck size={16} /><div><strong>Responsible AI</strong><span>Answers are limited to retrieved content. Missing evidence is called out.</span><button onClick={() => setActiveView('evaluation')}>Explore evaluation <ChevronRight size={12} /></button></div></div>
            </aside>
          </div>
        )}

        {activeView === 'library' && <LibraryView documents={documents} onUpload={() => fileRef.current?.click()} onRemove={removeDocument} onSelect={setSelectedSource} uploading={uploading} />}
        {activeView === 'evaluation' && <EvaluationView documents={documents} indexedPages={indexedPages} evaluations={messages.filter((message) => message.role === 'assistant' && message.evaluation)} />}
      </main>

      <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv" multiple hidden onChange={(event) => addFiles(event.target.files)} />

      {selectedSource && <div className="drawer-backdrop" onClick={() => setSelectedSource(null)}><aside className="source-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div className="drawer-file-icon"><FileText size={18} /></div><button className="icon-button" aria-label="Close source details" onClick={() => setSelectedSource(null)}><X size={18} /></button></div><span className="drawer-label">SOURCE DOCUMENT</span><h2>{selectedSource.title}</h2><p className="drawer-meta">{selectedSource.authors} · {selectedSource.pages} pages</p><div className="drawer-divider" /><div className="drawer-section-label">DOCUMENT PREVIEW</div><p className="document-preview">{selectedSource.text}</p><div className="drawer-footer"><span><ShieldCheck size={14} /> Indexed for retrieval</span><button onClick={() => { setActiveView('chat'); setSelectedSource(null); }}>Ask about this source <ArrowUp size={14} /></button></div></aside></div>}
      {dragging && <div className="drop-overlay"><div><Upload size={28} /><strong>Drop documents to index</strong><span>PDF, TXT, Markdown, or CSV</span></div></div>}
    </div>
  );
}

function LibraryView({ documents, onUpload, onRemove, onSelect, uploading }) {
  const [search, setSearch] = useState('');
  const filtered = documents.filter((document) => `${document.title} ${document.authors}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="page-view"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />KNOWLEDGE BASE</div><h1>Document library<span className="heading-period">.</span></h1><p>Your controlled collection of academic sources.</p></div><button className="primary-button" onClick={onUpload} disabled={uploading}><Upload size={16} />{uploading ? 'Indexing…' : 'Add documents'}</button></div><div className="library-toolbar"><div className="library-count"><strong>{documents.length}</strong> indexed documents <span>·</span> Ready to retrieve</div><label className="library-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search documents" /></label></div><div className="document-table"><div className="table-header"><span>DOCUMENT</span><span>TYPE</span><span>SIZE</span><span>STATUS</span><span /></div>{filtered.map((document) => <div className="document-row" key={document.id}><button className="document-title-cell" onClick={() => onSelect(document)}><span className={`document-type-icon ${document.color}`}><FileText size={17} /></span><span><strong>{document.title}</strong><small>{document.authors}</small></span></button><span className="document-type-label">{document.type}</span><span className="document-size">{document.pages} pages</span><span className="indexed-status"><span />Indexed</span><button className="icon-button quiet remove-button" aria-label={`Remove ${document.title}`} title="Remove document" onClick={() => onRemove(document.id)}><X size={15} /></button></div>)}{!filtered.length && <div className="empty-library"><FolderOpen size={22} /><strong>No matching documents</strong><span>Try a different search or add a source.</span></div>}</div><div className="library-footnote"><ShieldCheck size={15} /><span>Files are parsed locally in this browser. No documents are uploaded to a server.</span></div></section>;
}

function EvaluationGuide({ documents, indexedPages }) {
  return <section className="page-view evaluation-view"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />QUALITY &amp; SAFETY</div><h1>Evaluation<span className="heading-period">.</span></h1><p>Visibility into retrieval quality, grounding, and responsible use.</p></div><div className="demo-tag"><FlaskConical size={15} /> DEMO DATA</div></div><div className="evaluation-notice"><div className="notice-icon"><ShieldCheck size={18} /></div><div><strong>Evaluation harness not connected</strong><span>This prototype uses deterministic local keyword retrieval. Connect a model and a labeled question set to run production RAG metrics.</span></div></div><div className="metric-grid"><div className="metric-card"><span>Documents indexed</span><strong>{documents.length}</strong><small><FileText size={13} /> Controlled collection</small></div><div className="metric-card"><span>Pages available</span><strong>{indexedPages}</strong><small><Library size={13} /> Across all sources</small></div><div className="metric-card"><span>Grounded answer rate</span><strong>—</strong><small><ShieldCheck size={13} /> Requires labeled evaluation</small></div><div className="metric-card"><span>Retrieval precision @ 3</span><strong>—</strong><small><Search size={13} /> Requires relevance judgments</small></div></div><div className="evaluation-content"><div className="evaluation-table-wrap"><div className="evaluation-table-title"><div><h2>Evaluation checklist</h2><p>Signals to measure before deployment</p></div><span className="checklist-count">4 dimensions</span></div><div className="evaluation-row"><span className="dimension-icon green"><Search size={15} /></span><div><strong>Retrieval relevance</strong><small>Are the retrieved passages useful for the question?</small></div><span className="not-run">Not run</span></div><div className="evaluation-row"><span className="dimension-icon blue"><BookOpen size={15} /></span><div><strong>Faithfulness</strong><small>Is every answer claim supported by its cited context?</small></div><span className="not-run">Not run</span></div><div className="evaluation-row"><span className="dimension-icon coral"><ShieldCheck size={15} /></span><div><strong>Abstention &amp; safety</strong><small>Does the assistant decline when evidence is missing?</small></div><span className="not-run">Not run</span></div><div className="evaluation-row"><span className="dimension-icon gold"><FlaskConical size={15} /></span><div><strong>Bias &amp; coverage</strong><small>Are answers equitable across topics and communities?</small></div><span className="not-run">Not run</span></div></div><aside className="evaluation-method"><div className="method-icon"><Settings2 size={17} /></div><h2>Evaluation protocol</h2><p>A useful baseline combines retrieval and generation metrics with human review.</p><div className="method-item"><span>01</span><div><strong>Build a test set</strong><small>Representative questions, reference answers, and relevant passages.</small></div></div><div className="method-item"><span>02</span><div><strong>Measure the pipeline</strong><small>Context precision, faithfulness, answer relevance, and abstention.</small></div></div><div className="method-item"><span>03</span><div><strong>Review responsibly</strong><small>Check privacy, accessibility, bias, and high-impact failure modes.</small></div></div></aside></div></section>;
}

function EvaluationView({ documents, indexedPages, evaluations }) {
  const latestAnswer = evaluations.at(-1);
  const [selectedAnswerId, setSelectedAnswerId] = useState(latestAnswer?.id ?? '');
  const selectedAnswer = evaluations.find((message) => message.id === selectedAnswerId) ?? latestAnswer;
  const [answer, setAnswer] = useState(selectedAnswer?.text ?? '');
  const [documentId, setDocumentId] = useState(selectedAnswer?.sources?.[0]?.document.id ?? documents[0]?.id ?? '');
  const [customReport, setCustomReport] = useState(null);
  const [evaluationNotice, setEvaluationNotice] = useState('');
  const activeReport = customReport ?? selectedAnswer?.evaluation ?? null;
  const selectedDocument = documents.find((document) => document.id === documentId);
  const claims = activeReport?.grounding.claims ?? [];
  const supportRate = activeReport?.grounding.supportRate;
  const biasSignals = activeReport?.biasSignals ?? [];

  function runEvaluation() {
    if (!answer.trim() || !selectedDocument) {
      setEvaluationNotice('Add an answer and select an indexed source before running checks.');
      return;
    }
    const answerClaims = (answer.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
      .map((text) => text.trim())
      .filter((text) => queryTerms(text).length > 2);
    const reportClaims = answerClaims.map((text) => ({
      text,
      evidence: selectedDocument.text,
      source: selectedDocument.title,
      task: 'Manual source comparison',
    }));
    setCustomReport({
      grounding: evaluateGrounding(reportClaims),
      biasSignals: detectBiasSignals(answer),
      missingTasks: [],
      plan: { subtasks: ['Manual answer review'], isComplex: false },
    });
    setEvaluationNotice('Checks complete. Review every claim and open the original source before drawing conclusions.');
  }

  return (
    <section className="page-view evaluation-view">
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" />QUALITY &amp; SAFETY</div><h1>Evaluation<span className="heading-period">.</span></h1><p>Inspect answer support and review possible group-generalization cues.</p></div>
        <div className="demo-tag"><FlaskConical size={15} /> LOCAL HEURISTICS</div>
      </div>

      <div className="evaluation-notice"><div className="notice-icon"><ShieldCheck size={18} /></div><div><strong>Signals for review, not certification</strong><span>Lexical overlap can miss paraphrases or contradictions. Bias cues are narrow wording checks, not a fairness measure. Human review remains essential.</span></div></div>

      <div className="metric-grid">
        <div className="metric-card"><span>Documents indexed</span><strong>{documents.length}</strong><small><FileText size={13} /> Controlled collection</small></div>
        <div className="metric-card"><span>Pages available</span><strong>{indexedPages}</strong><small><Library size={13} /> Across all sources</small></div>
        <div className="metric-card"><span>Claim overlap</span><strong>{supportRate == null ? '—' : `${Math.round(activeReport.grounding.averageOverlap * 100)}%`}</strong><small><BookOpen size={13} /> Lexical support estimate</small></div>
        <div className="metric-card"><span>Bias cues flagged</span><strong>{activeReport ? biasSignals.length : '—'}</strong><small><ShieldCheck size={13} /> Review with context</small></div>
      </div>

      {evaluationNotice && <div className="evaluation-result-notice" role="status">{evaluationNotice}</div>}

      <div className="evaluation-workbench">
        <div className="evaluation-editor">
          <div className="evaluation-editor-heading"><div><h2>Answer review</h2><p>Evaluate an agent answer or paste a response to compare.</p></div><span className="editor-step">01 / 02</span></div>
          {evaluations.length > 0 && <label className="evaluation-field"><span>Agent answer</span><select value={selectedAnswerId || latestAnswer.id} onChange={(event) => { const next = evaluations.find((message) => message.id === event.target.value); setSelectedAnswerId(event.target.value); setAnswer(next?.text ?? ''); setCustomReport(null); }}><option value="" disabled>Select an answer</option>{evaluations.map((message, index) => <option key={message.id} value={message.id}>{index + 1}. {(message.question ?? 'Research answer').slice(0, 72)}</option>)}</select></label>}
          <label className="evaluation-field"><span>Answer text</span><textarea value={answer} onChange={(event) => { setAnswer(event.target.value); setCustomReport(null); }} placeholder="Paste an answer to evaluate its claims and wording cues..." rows="7" /></label>
          <label className="evaluation-field"><span>Compare against source</span><select value={documentId} onChange={(event) => { setDocumentId(event.target.value); setCustomReport(null); }}><option value="">Select a source</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label>
          <div className="evaluation-controls"><span><ShieldCheck size={14} /> Runs locally in this browser</span><button className="primary-button" onClick={runEvaluation} disabled={!documents.length}><FlaskConical size={15} />Run checks</button></div>
        </div>

        <div className="evaluation-results">
          <div className="evaluation-results-heading"><div><h2>Review results</h2><p>{activeReport ? 'Heuristic checks against selected evidence' : 'Run checks to inspect answer support'}</p></div><span className={activeReport ? 'review-status ready' : 'review-status'}>{activeReport ? 'REVIEW' : 'WAITING'}</span></div>
          {activeReport ? <>
            <div className="result-summary"><div><strong>{claims.filter((claim) => claim.status === 'supported').length}<small>/{claims.length}</small></strong><span>claims with strong overlap</span></div><div className="summary-divider" /><div><strong className={biasSignals.length ? 'warning-number' : ''}>{biasSignals.length}</strong><span>possible bias cues</span></div></div>
            <div className="claim-list-heading">CLAIM-LEVEL SUPPORT <span>{claims.length} checked</span></div>
            <div className="claim-list">{claims.map((claim, index) => <article className="claim-result" key={`${index}-${claim.text}`}><div className="claim-result-top"><span className={`claim-status ${claim.status}`}>{claim.status === 'supported' ? 'Strong overlap' : claim.status === 'review' ? 'Review wording' : 'Weak overlap'}</span><span>{Math.round(claim.support * 100)}%</span></div><p>{claim.text}</p><small><FileText size={12} /> {claim.source}</small></article>)}{!claims.length && <div className="no-claims">No verifiable claims were detected in this answer.</div>}</div>
            <div className="bias-review"><div className="bias-review-heading"><ShieldCheck size={15} /><strong>Bias &amp; wording review</strong><span>{biasSignals.length ? 'Human review suggested' : 'No cues found'}</span></div>{biasSignals.length ? biasSignals.map((signal, index) => <p key={`${index}-${signal}`}>“{signal}”</p>) : <p>No group-term plus sweeping-language pattern detected. This does not establish that the answer is unbiased.</p>}</div>
            {activeReport.missingTasks?.length > 0 && <div className="missing-evidence"><strong>Unanswered sub-questions</strong>{activeReport.missingTasks.map((task) => <span key={task}>{task}</span>)}</div>}
          </> : <div className="evaluation-empty"><div className="empty-glyph"><Gauge size={20} /></div><strong>No checks run yet</strong><span>Choose an answer, select a source, and run the local review.</span></div>}
        </div>
      </div>

      <div className="evaluation-method-note"><strong>Interpretation limits</strong><span>Overlap is a token match ratio, not a probability that the answer is true. The cue scan only flags sentences that combine selected demographic terms with sweeping wording; it cannot judge fairness, intent, or context.</span></div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>,
);