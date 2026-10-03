import * as vscode from 'vscode';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import { loadContextFromFolder, emptyContext } from './context';

export function activate(vscodeContext: vscode.ExtensionContext) {
  
  // ==========================================
  // 1. COMMANDE : Exécuter le code RPGLE
  // ==========================================
  let executeDisposable = vscode.commands.registerCommand('rpgle.execute', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Aucun fichier ouvert');
      return;
    }

    const code = editor.document.getText();
    
    try {
      // 1. Charger le contexte de manière sécurisée et intelligente
      let execContext = emptyContext();
      let contextPath: string | null = null;

      console.log('=== DÉBUT DEBUG CHARGEMENT CONTEXTE ===');
      
      // Stratégie 1 : Utiliser le dossier du workspace (idéal, si "Ouvrir le dossier" a été utilisé)
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        contextPath = path.join(workspaceRoot, 'context');
        console.log('📂 Stratégie 1 : Dossier workspace détecté ->', contextPath);
      } 
      // Stratégie 2 : Fallback sur le dossier du fichier ouvert (si "Ouvrir un fichier" a été utilisé)
      else if (editor.document.uri.scheme === 'file') {
        const fileDir = path.dirname(editor.document.uri.fsPath); // ex: ...\fichiers_test
        const projectDir = path.dirname(fileDir);                 // remonte à: ...\vscode-rpgle-interpreter
        contextPath = path.join(projectDir, 'context');           // cible: ...\vscode-rpgle-interpreter\context
        console.log('📂 Stratégie 2 : Fallback fichier détecté ->', contextPath);
      } else {
        console.error('⚠️ ERREUR CRITIQUE : Impossible de déterminer le chemin du projet.');
      }

      if (contextPath) {
        try {
          execContext = loadContextFromFolder(contextPath);
          console.log('✅ Contexte chargé. Tables trouvées :', Object.keys(execContext.tables));
        } catch (e: any) {
          console.error('❌ Erreur lors du chargement :', e.message);
        }
      }
      console.log('=== FIN DEBUG CHARGEMENT CONTEXTE ===');

      // 2. Lexer & Parser
      const lexer = new Lexer(code);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const ast = parser.parse();
      
      // 3. Interprétation (on passe l'objet de contexte complet)
      const interpreter = new Interpreter(execContext);
      const output = interpreter.execute(ast);
      
      // 4. Affichage des résultats
      const outputChannel = vscode.window.createOutputChannel('RPGLE Output');
      outputChannel.clear();
      outputChannel.appendLine('=== Exécution RPGLE ===');
      output.forEach(line => outputChannel.appendLine(line));
      outputChannel.show();
      
      vscode.window.showInformationMessage('Exécution terminée avec succès');
      
    } catch (error: any) {
      vscode.window.showErrorMessage(`Erreur d'exécution: ${error.message}`);
    }
  });

  // ==========================================
  // 2. COMMANDE : Valider la syntaxe
  // ==========================================
  let validateDisposable = vscode.commands.registerCommand('rpgle.validate', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Aucun fichier ouvert');
      return;
    }

    const code = editor.document.getText();
    
    try {
      const lexer = new Lexer(code);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      parser.parse();
      
      vscode.window.showInformationMessage('Syntaxe RPGLE valide ✓');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Erreur de syntaxe: ${error.message}`);
    }
  });

  vscodeContext.subscriptions.push(executeDisposable, validateDisposable);

  // ==========================================
  // 3. DIAGNOSTIC EN TEMPS RÉEL (Soulignement rouge)
  // ==========================================
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('rpgle');
  
  vscodeContext.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.languageId === 'rpgle') {
        validateDocument(event.document, diagnosticCollection);
      }
    })
  );

  if (vscode.window.activeTextEditor?.document.languageId === 'rpgle') {
    validateDocument(vscode.window.activeTextEditor.document, diagnosticCollection);
  }
}

function validateDocument(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
  const diagnostics: vscode.Diagnostic[] = [];
  
  try {
    const lexer = new Lexer(document.getText());
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    parser.parse();
  } catch (error: any) {
    const match = error.message.match(/ligne (\d+)/i) || error.message.match(/line (\d+)/i);
    const line = match ? parseInt(match[1]) - 1 : 0;
    
    const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);
    const diagnostic = new vscode.Diagnostic(
      range,
      error.message,
      vscode.DiagnosticSeverity.Error
    );
    diagnostics.push(diagnostic);
  }
  
  diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {}