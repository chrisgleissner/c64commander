#!/usr/bin/env node
/**
 * Inventory all CTAs (Call-To-Actions) in the application.
 * Scans React components for buttons, links, and interactive elements.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const rootDir = process.cwd();
const srcDir = join(rootDir, 'src');

const componentPatterns = {
  button: /<Button\b[^>]*>/g,
  link: /<Link\b[^>]*to=/g,
  anchor: /<a\b[^>]*href=/g,
  buttonElement: /<button\b[^>]*>/g,
  checkbox: /<Checkbox\b[^>]*>/g,
  input: /<Input\b[^>]*>/g,
  select: /<Select\b[^>]*>/g,
  quickAction: /<QuickActionCard\b[^>]*>/g,
};

function extractLabel(line, fullContent, lineNumber) {
  // Try to extract button label
  const ariaLabelMatch = line.match(/aria-label=["']([^"']+)["']/);
  if (ariaLabelMatch) return ariaLabelMatch[1];
  
  const dataTestIdMatch = line.match(/data-testid=["']([^"']+)["']/);
  if (dataTestIdMatch) return `[testid: ${dataTestIdMatch[1]}]`;
  
  // Look for text content on next few lines
  const lines = fullContent.split('\n');
  for (let i = lineNumber; i < Math.min(lineNumber + 5, lines.length); i++) {
    const textMatch = lines[i].match(/>\s*([A-Z][^<>]{2,30})\s*</);
    if (textMatch) return textMatch[1].trim();
  }
  
  return '[unlabeled]';
}

function extractOnClick(line, fullContent, lineNumber) {
  const onClickMatch = line.match(/onClick=\{([^}]+)\}/);
  if (onClickMatch) return onClickMatch[1].trim();
  
  const onSelectMatch = line.match(/onSelect=\{([^}]+)\}/);
  if (onSelectMatch) return onSelectMatch[1].trim();
  
  return null;
}

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const relativePath = relative(srcDir, filePath);
  const lines = content.split('\n');
  const ctas = [];

  for (const [type, pattern] of Object.entries(componentPatterns)) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const matchIndex = match.index;
      const lineNumber = content.substring(0, matchIndex).split('\n').length;
      const line = lines[lineNumber - 1];
      
      const label = extractLabel(line, content, lineNumber);
      const handler = extractOnClick(line, content, lineNumber);
      
      ctas.push({
        file: relativePath,
        line: lineNumber,
        type,
        label,
        handler,
        snippet: line.trim().substring(0, 100),
      });
    }
  }

  return ctas;
}

function scanDirectory(dir, ctas = []) {
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (!entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist') {
        scanDirectory(fullPath, ctas);
      }
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      ctas.push(...scanFile(fullPath));
    }
  }
  
  return ctas;
}

console.log('Scanning for CTAs...');
const allCTAs = scanDirectory(srcDir);

console.log(`\nFound ${allCTAs.length} CTAs`);

// Group by page
const byPage = allCTAs.reduce((acc, cta) => {
  const page = cta.file.split('/')[1] || 'other';
  if (!acc[page]) acc[page] = [];
  acc[page].push(cta);
  return acc;
}, {});

// Generate report
const report = {
  totalCTAs: allCTAs.length,
  byType: {},
  byPage: {},
  details: allCTAs,
};

for (const cta of allCTAs) {
  report.byType[cta.type] = (report.byType[cta.type] || 0) + 1;
}

for (const [page, ctas] of Object.entries(byPage)) {
  report.byPage[page] = ctas.length;
}

// Write JSON report
writeFileSync(
  join(rootDir, 'cta-inventory.json'),
  JSON.stringify(report, null, 2),
  'utf-8'
);

console.log('\nCTAs by type:');
for (const [type, count] of Object.entries(report.byType)) {
  console.log(`  ${type}: ${count}`);
}

console.log('\nCTAs by page:');
for (const [page, count] of Object.entries(report.byPage)) {
  console.log(`  ${page}: ${count}`);
}

console.log('\nReport written to cta-inventory.json');
