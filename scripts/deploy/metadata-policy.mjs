import ts from 'typescript';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { committedFiles, inputManifest } from '../build/inputs.mjs';
import {
  digest,
  validateProvenance,
} from '../../src/platform/config/build-model.ts';
import { refuse } from './rollout-client.mjs';

const PATH = 'src/modules/meta/meta.controller.ts';
const ENVELOPE = 'src/platform/http/envelope.ts';
function source(path, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65536)
    refuse('METADATA_POLICY_SOURCE_INVALID');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    refuse('METADATA_POLICY_SOURCE_INVALID');
  }
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  if (file.parseDiagnostics.length) refuse('METADATA_POLICY_SOURCE_INVALID');
  return file;
}
function constant(file, name) {
  const values = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .filter(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name,
    );
  if (values.length !== 1 || !values[0].initializer)
    refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
  return values[0].initializer;
}
function key(node) {
  if (!node || !(ts.isIdentifier(node) || ts.isStringLiteral(node)))
    refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
  return node.text;
}
// Interpret only JSON literals and one explicit constant reference. No source
// module, decorator, constructor, getter or arbitrary expression is executed.
function literal(node, constants = new Map()) {
  if (!node) refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
    return literal(node.expression, constants);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node) && Number.isSafeInteger(Number(node.text)))
    return Number(node.text);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isIdentifier(node) && constants.has(node.text))
    return structuredClone(constants.get(node.text));
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((part) => literal(part, constants));
  if (ts.isObjectLiteralExpression(node)) {
    const entries = [];
    const names = new Set();
    for (const part of node.properties) {
      if (!ts.isPropertyAssignment(part))
        refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
      const name = key(part.name);
      if (
        names.has(name) ||
        ['__proto__', 'prototype', 'constructor'].includes(name)
      )
        refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
      names.add(name);
      entries.push([name, literal(part.initializer, constants)]);
    }
    return Object.fromEntries(entries);
  }
  refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
}
export function metadataPolicyFromSource(controllerBytes, envelopeBytes) {
  const file = source(PATH, controllerBytes);
  const contractVersion = literal(
    constant(source(ENVELOPE, envelopeBytes), 'CONTRACT_VERSION'),
  );
  if (typeof contractVersion !== 'string')
    refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
  const limits = literal(constant(file, 'API_LIMITS'));
  const classes = file.statements.filter(
    (statement) =>
      ts.isClassDeclaration(statement) &&
      statement.name?.text === 'MetaController',
  );
  const methods = classes[0]?.members.filter(
    (member) => ts.isMethodDeclaration(member) && key(member.name) === 'get',
  );
  if (
    classes.length !== 1 ||
    methods?.length !== 1 ||
    methods[0].parameters.length ||
    methods[0].body?.statements.length !== 1 ||
    !ts.isReturnStatement(methods[0].body.statements[0]) ||
    !ts.isObjectLiteralExpression(methods[0].body.statements[0].expression)
  )
    refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
  const result = {};
  const seen = new Set();
  for (const property of methods[0].body.statements[0].expression.properties) {
    if (!ts.isPropertyAssignment(property))
      refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
    const name = key(property.name);
    if (
      seen.has(name) ||
      ![
        'apiMajor',
        'contractVersion',
        'markdownContractVersion',
        'features',
        'limits',
        'clients',
        'lifecycle',
        'buildSha',
        'deployment',
      ].includes(name)
    )
      refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
    seen.add(name);
    if (['buildSha', 'deployment'].includes(name)) continue;
    if (name === 'contractVersion') {
      if (
        !ts.isIdentifier(property.initializer) ||
        property.initializer.text !== 'CONTRACT_VERSION'
      )
        refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
      result[name] = contractVersion;
    } else
      result[name] = literal(
        property.initializer,
        new Map([['API_LIMITS', limits]]),
      );
  }
  if (seen.size !== 9) refuse('METADATA_POLICY_EXPRESSION_UNSUPPORTED');
  return result;
}

export function gitMetadataPolicyReader(root = process.cwd()) {
  root = resolve(root);
  const cache = new Map();
  return async (provenance) => {
    const build = validateProvenance(provenance);
    if (build.environment === 'development') refuse('CLOUD_ARTIFACT_REQUIRED');
    const identity = digest(build);
    if (cache.has(identity)) return structuredClone(cache.get(identity));
    try {
      const files = committedFiles(root, build.sourceSha, { timeoutMs: 5000 });
      const manifest = await inputManifest(
        root,
        build.environment,
        build.configuration,
        files,
      );
      if (
        digest(manifest) !== build.runtimeInputDigest ||
        digest({
          schemaVersion: 1,
          targetPlatform: manifest.targetPlatform,
          entries: manifest.entries,
        }) !== build.sourceInputDigest
      )
        refuse('METADATA_POLICY_INPUTS_MISMATCH');
      const bytes = (path) => {
        const value = files.find((file) => file.path === path)?.bytes;
        if (!value) refuse('METADATA_POLICY_SOURCE_UNAVAILABLE');
        return value;
      };
      if (
        createHash('sha256')
          .update(bytes('contracts/openapi-v1.json'))
          .digest('hex') !== build.contractSha256 ||
        JSON.parse(bytes('package.json')).version !== build.applicationVersion
      )
        refuse('METADATA_POLICY_INPUTS_MISMATCH');
      const policy = metadataPolicyFromSource(bytes(PATH), bytes(ENVELOPE));
      if (policy.contractVersion !== build.contractVersion)
        refuse('METADATA_POLICY_INPUTS_MISMATCH');
      cache.set(identity, policy);
      return structuredClone(policy);
    } catch (error) {
      if (error?.code?.startsWith('METADATA_POLICY_')) throw error;
      refuse('METADATA_POLICY_SOURCE_UNAVAILABLE');
    }
  };
}
