import * as vscode from 'vscode';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import { loadContextFromFolder } from './context';

export function activate(vscodeContext: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('RPGLE Output');
  const diagnostics = vscode.languages.createDiagnosticCollection('rpgle');
  vscodeContext.subscriptions.push(output, diagnostics);

  // ==========================================
  // 1. COMMANDE : Exécuter le code RPGLE
  // ==========================================
  vscodeContext.subscriptions.push(vscode.commands.registerCommand('rpgle.execute', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Aucun fichier ouvert');
      return;
    }

    output.clear();
    output.appendLine('=== Exécution RPGLE ===');
    output.show(true);

    try {
      const contextPath = findContextFolder(editor.document);
      const execContext = loadContextFromFolder(contextPath);
      const tables = Object.keys(execContext.tables);
      output.appendLine(tables.length > 0
        ? `Contexte : ${contextPath} (tables : ${tables.join(', ')})`
        : `Contexte : aucun tables.json dans ${contextPath}`);

      const ast = new Parser(new Lexer(editor.document.getText()).tokenize()).parse();
      const lines = new Interpreter(execContext).execute(ast);

      lines.forEach(line => output.appendLine(line));
      vscode.window.showInformationMessage('Exécution terminée avec succès');
    } catch (error: any) {
      output.appendLine(`Erreur : ${error.message}`);
      vscode.window.showErrorMessage(`Erreur d'exécution: ${error.message}`);
    }
  }));

  // ==========================================
  // 2. COMMANDE : Valider la syntaxe
  // ==========================================
  vscodeContext.subscriptions.push(vscode.commands.registerCommand('rpgle.validate', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Aucun fichier ouvert');
      return;
    }

    try {
      new Parser(new Lexer(editor.document.getText()).tokenize()).parse();
      vscode.window.showInformationMessage('Syntaxe RPGLE valide ✓');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Erreur de syntaxe: ${error.message}`);
    }
  }));

  // ==========================================
  // 3. DIAGNOSTIC EN TEMPS RÉEL (Soulignement rouge)
  // ==========================================
  const validateIfRpgle = (document: vscode.TextDocument) => {
    if (document.languageId === 'rpgle') {
      validateDocument(document, diagnostics);
    }
  };

  vscodeContext.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validateIfRpgle),
    vscode.workspace.onDidChangeTextDocument(event => validateIfRpgle(event.document)),
    vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri))
  );

  vscode.workspace.textDocuments.forEach(validateIfRpgle);
}

// Dossier context/ : à la racine du dossier de workspace qui contient le fichier,
// sinon à côté du dossier parent du fichier (ex : fichiers_test/../context)
function findContextFolder(document: vscode.TextDocument): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (workspaceFolder) {
    return path.join(workspaceFolder.uri.fsPath, 'context');
  }
  return path.join(path.dirname(path.dirname(document.uri.fsPath)), 'context');
}

function validateDocument(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
  const found: vscode.Diagnostic[] = [];

  try {
    new Parser(new Lexer(document.getText()).tokenize()).parse();
  } catch (error: any) {
    const match = error.message.match(/ligne (\d+)/i) || error.message.match(/line (\d+)/i);
    const line = match ? parseInt(match[1]) - 1 : 0;
    const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);
    found.push(new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error));
  }

  diagnosticCollection.set(document.uri, found);
}

export function deactivate() {}
