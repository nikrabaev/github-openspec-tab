import type { PhrasingContent } from 'mdast';

/** Inline formatting carried by a token, so a diff keeps bold, code and links. */
export interface Marks {
  strong?: boolean;
  emphasis?: boolean;
  delete?: boolean;
  code?: boolean;
  /** Link target, when the token is inside a link. */
  link?: string;
}

export interface Token {
  text: string;
  marks: Marks;
  /** Whitespace tokens are diffed but never count as a change on their own. */
  space: boolean;
}

const WORDS = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** Flatten inline Markdown into word, space and punctuation tokens with their formatting. */
export function tokenize(nodes: readonly PhrasingContent[], marks: Marks = {}): Token[] {
  const tokens: Token[] = [];
  const pushText = (text: string, tokenMarks: Marks) => {
    for (const match of text.matchAll(WORDS)) {
      tokens.push({ text: match[0], marks: tokenMarks, space: /^\s+$/.test(match[0]) });
    }
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        pushText(node.value, marks);
        break;
      case 'inlineCode':
        // Code is one token: `DOCK_TIMEOUT` changes as a whole or not at all.
        tokens.push({ text: node.value, marks: { ...marks, code: true }, space: false });
        break;
      case 'strong':
        tokens.push(...tokenize(node.children, { ...marks, strong: true }));
        break;
      case 'emphasis':
        tokens.push(...tokenize(node.children, { ...marks, emphasis: true }));
        break;
      case 'delete':
        tokens.push(...tokenize(node.children, { ...marks, delete: true }));
        break;
      case 'link':
        tokens.push(...tokenize(node.children, { ...marks, link: node.url }));
        break;
      case 'break':
        tokens.push({ text: '\n', marks, space: true });
        break;
      case 'image':
        pushText(node.alt ? `[image: ${node.alt}]` : '[image]', marks);
        break;
      case 'html':
        // Raw HTML is shown as the text it is, never interpreted.
        pushText(node.value, marks);
        break;
      default:
        if ('children' in node) tokens.push(...tokenize(node.children as PhrasingContent[], marks));
        else if ('value' in node && typeof node.value === 'string') pushText(node.value, marks);
    }
  }
  return tokens;
}

/** What makes two tokens "the same word": text, whether it is code, and where it links. */
export const tokenKey = (token: Token) =>
  `${token.marks.code ? '`' : ''}${token.text}${token.marks.link ? `\u0000${token.marks.link}` : ''}`;

export const tokensText = (tokens: readonly Token[]) => tokens.map((token) => token.text).join('');
