import { expect } from 'chai';
import * as MarkdownIt from 'markdown-it';
import {
  TypeInformation,
  PropertyDocumentationBlock,
  MethodParameterDocumentation,
} from './ParsedDocumentation';

export type MarkdownTokens = ReturnType<MarkdownIt['parse']>;

export const findNextList = (tokens: MarkdownTokens) => {
  const start = tokens.findIndex(t => t.type === 'bullet_list_open');
  if (start === -1) return null;
  let opened = 1;
  let end = -1;
  for (const [index, token] of tokens.slice(start + 1).entries()) {
    if (token.type === 'bullet_list_open') opened += 1;
    if (token.type === 'bullet_list_close') opened -= 1;
    if (opened === 0) {
      end = index;
      break;
    }
  }
  if (end === -1) return null;

  return tokens.slice(start, start + end + 1);
};

export const findFirstHeading = (tokens: MarkdownTokens) => {
  const open = tokens.findIndex(token => token.type === 'heading_open');
  expect(open).to.not.equal(-1, "expected to find a heading token but couldn't");
  expect(tokens[open + 2].type).to.equal('heading_close');
  return tokens[open + 1];
};

export const findContentAfterList = (tokens: MarkdownTokens) => {
  const start = tokens.findIndex(t => t.type === 'bullet_list_close');
  if (start === -1) return [];
  const end = tokens.slice(start).findIndex(t => t.type === 'heading_open');
  if (end === -1) return tokens.slice(start + 1);
  return tokens.slice(start + 1, end);
};

export type HeadingContent = {
  heading: string;
  level: number;
  headingTokens: MarkdownTokens;
  content: MarkdownTokens;
};

export const headingsAndContent = (tokens: MarkdownTokens): HeadingContent[] => {
  const groups: HeadingContent[] = [];
  for (const [start, token] of tokens.entries()) {
    if (token.type !== 'heading_open') continue;

    const headingTokens = tokens.slice(
      start + 1,
      start +
        tokens.slice(start).findIndex(t => t.type === 'heading_close' && t.level === token.level),
    );

    const startLevel = parseInt(token.tag.replace('h', ''), 10);

    const content = tokens.slice(start + headingTokens.length);
    const contentEnd = content.findIndex(
      t => t.type === 'heading_open' && parseInt(t.tag.replace('h', ''), 10) <= startLevel,
    );

    groups.push({
      heading: safelyJoinTokens(headingTokens).trim(),
      level: startLevel,
      headingTokens,
      content: contentEnd === -1 ? content : content.slice(0, contentEnd),
    });
  }

  return groups;
};

export const findConstructorHeader = (tokens: MarkdownTokens) => {
  const groups = headingsAndContent(tokens);
  const constructorHeader = groups.find(
    group => group.heading.startsWith('`new ') && group.level === 3,
  );
  return constructorHeader ? constructorHeader : null;
};

export const findContentInsideHeader = (
  tokens: MarkdownTokens,
  expectedHeader: string,
  expectedLevel: number,
) => {
  const group = headingsAndContent(tokens).find(
    g => g.heading === expectedHeader && g.level === expectedLevel,
  );
  if (!group) return null;
  return group.content;
};

export const rawTypeToTypeInformation = (
  rawType: string,
  subTypedKeys: TypedKey[] | null,
): TypeInformation => {
  let collection = false;
  let typeString = rawType;
  if (rawType.endsWith('[]')) {
    collection = true;
    typeString = rawType.substr(0, rawType.length - 2);
  }
  typeString = typeString.trim().replace(/^\((.+)\)$/, '$1');

  const multiTypes = typeString.split('|');
  if (multiTypes.length > 1) {
    return {
      collection,
      type: multiTypes
        .map(multiType => multiType.trim())
        .map(multiType => rawTypeToTypeInformation(multiType, subTypedKeys)),
    };
  }

  if (typeString === 'Function') {
    return {
      collection,
      type: 'Function',
      parameters: subTypedKeys
        ? subTypedKeys.map<MethodParameterDocumentation>(typedKey => ({
            name: typedKey.key,
            description: typedKey.description,
            required: typedKey.required,
            ...typedKey.type,
          }))
        : [],
    };
  } else if (typeString === 'Object') {
    return {
      collection,
      type: 'Object',
      properties: subTypedKeys
        ? subTypedKeys.map<PropertyDocumentationBlock>(typedKey => ({
            name: typedKey.key,
            description: typedKey.description,
            required: typedKey.required,
            ...typedKey.type,
          }))
        : [],
    };
  }

  return {
    collection,
    type: typeString,
  };
};

// NOTE: This method obliterates code fences
export const safelyJoinTokens = (tokens: MarkdownTokens) => {
  let joinedContent = '';
  for (const tokenToCheck of tokens) {
    if (tokenToCheck.children !== null && tokenToCheck.type === 'inline') {
      joinedContent += safelyJoinTokens(tokenToCheck.children);
      continue;
    }
    expect(tokenToCheck.children).to.equal(
      null,
      'There should be no nested children in the joinable tokens',
    );

    expect(tokenToCheck.type).to.be.oneOf(
      [
        'text',
        'link_open',
        'link_close',
        'softbreak',
        'code_inline',
        'strong_open',
        'strong_close',
        'paragraph_open',
        'paragraph_close',
        'bullet_list_open',
        'bullet_list_close',
        'list_item_open',
        'list_item_close',
        'em_open',
        'em_close',
        'fence',
        's_open',
        's_close',
        'blockquote_open',
        'blockquote_close',
      ],
      'We only support plain text, links, softbreaks, inline code, strong tags and paragraphs inside joinable tokens',
    );
    // Be explicit here about which token types we support and the actions that are taken
    switch (tokenToCheck.type) {
      case 'softbreak':
        joinedContent += ' ';
        break;
      case 'code_inline':
        joinedContent += `${tokenToCheck.markup}${tokenToCheck.content}${tokenToCheck.markup}`;
        break;
      case 'blockquote_open':
        joinedContent += `${tokenToCheck.markup} `;
        break;
      case 'strong_open':
      case 'strong_close':
      case 'em_open':
      case 'em_close':
      case 's_open':
      case 's_close':
        joinedContent += tokenToCheck.markup;
        break;
      case 'text':
      case 'link_open':
      case 'link_close':
        joinedContent += tokenToCheck.content;
        break;
      case 'paragraph_close':
        joinedContent += '\n\n';
        break;
      case 'list_item_open':
        joinedContent += '* ';
        break;
      case 'list_item_close': {
        if (joinedContent.endsWith('\n'))
          joinedContent = joinedContent.slice(0, joinedContent.length - 1);
        break;
      }
      case 'paragraph_open':
      case 'bullet_list_open':
      case 'bullet_list_close':
      case 'blockquote_close':
      case 'fence':
        break;
      default:
        expect(false).to.equal(true, 'unreachable default switch case');
    }
  }

  return joinedContent.trim();
};

type TypedKey = {
  key: string;
  type: TypeInformation;
  description: string;
  required: boolean;
};

type List = { items: ListItem[] };
type ListItem = { tokens: MarkdownTokens; nestedList: List | null };

const getNestedList = (rawTokens: MarkdownTokens): List => {
  const rootList: List = { items: [] };

  const depthMap: Map<number, List | null> = new Map();
  depthMap.set(0, rootList);
  let current: ListItem | null = null;
  let currentDepth = 0;
  for (const token of rawTokens) {
    const currentList = depthMap.get(currentDepth)!;
    if (token.type === 'list_item_close') {
      if (current && !currentList.items.includes(current)) currentList.items.push(current);
      current = null;
    } else if (token.type === 'list_item_open') {
      current = { tokens: [], nestedList: null };
    } else if (token.type === 'bullet_list_open' && current) {
      expect(currentList).to.not.equal(
        null,
        'we should not ever have a sub list without a parent list',
      );
      current!.nestedList = { items: [] };
      currentDepth += 1;
      depthMap.set(currentDepth, current!.nestedList!);
      currentList.items.push(current);
    } else if (token.type === 'bullet_list_close') {
      depthMap.set(currentDepth, null);
      currentDepth -= 1;
    } else {
      if (current) current.tokens.push(token);
    }
    // if ((global as any).__debug) console.log(token.type, currentDepth, !!current, currentList);
  }

  return rootList;
};

const convertNestedListToTypedKeys = (list: List): TypedKey[] => {
  const keys: TypedKey[] = [];

  for (const item of list.items) {
    // Anything other than 3 items and the logic below is making a bad assumption, let's fail violently
    expect(item.tokens).to.have.lengthOf(
      3,
      'Expected list item representing a typed key to have 3 child tokens',
    );

    // We take the middle token as it is the thing enclosed in the paragraph
    const targetToken = item.tokens[1];
    // Need at least a key and a type
    expect(targetToken.children.length).to.be.at.least(
      2,
      'Expected token token to have at least 2 children for typed key extraction',
    );
    const keyToken = targetToken.children[0];
    expect(keyToken.type).to.equal('code_inline', 'Expected key token to be an inline code block');
    const typeAndDescriptionTokens = targetToken.children.slice(1);

    const joinedContent = safelyJoinTokens(typeAndDescriptionTokens);

    const rawType = joinedContent.split('-')[0];
    const rawDescription = joinedContent.substr(rawType.length);

    expect(rawDescription).not.to.match(
      / ?\(optional\) ?/i,
      'optionality for a typed key should be defined before the "-" and after the type',
    );

    const isRootOptional = / ?\(optional\) ?/i.test(rawType);
    const cleanedType = rawType.replace(/ ?\(optional\) ?/i, '');
    const subTypedKeys = item.nestedList ? convertNestedListToTypedKeys(item.nestedList) : null;
    const type = rawTypeToTypeInformation(cleanedType.trim(), subTypedKeys);

    keys.push({
      type,
      key: keyToken.content,
      description: rawDescription.trim().replace(/^- ?/, ''),
      required: !isRootOptional,
    });
  }

  return keys;
};

export const convertListToTypedKeys = (listTokens: MarkdownTokens): TypedKey[] => {
  const list = getNestedList(listTokens);

  return convertNestedListToTypedKeys(list);
};
