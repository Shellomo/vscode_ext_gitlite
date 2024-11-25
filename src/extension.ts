import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface CodeSnapshot {
    name: string;
    timestamp: number;
    files: { [path: string]: string };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "nogit" is now active!');
    const snapshots: CodeSnapshot[] = [];
    const snapshotsFile = context.storageUri ? path.join(context.storageUri.fsPath, 'snapshots.json') : '';

    // Load existing snapshots
    if (!context.storageUri) {
        vscode.window.showErrorMessage('Storage is not available');
        return;
    }
    try {
        if (fs.existsSync(snapshotsFile)) {
            console.log('Loading snapshots from disk');
            const data = fs.readFileSync(snapshotsFile, 'utf8');
            snapshots.push(...JSON.parse(data));
        }
        else {
            console.log('No snapshots found, creating new file');
            fs.writeFileSync(snapshotsFile, '[]');
        }
    } catch (error) {
        console.log('error', error)
        console.error('Failed to load snapshots:', error);
    }

    // Save current state
    let saveSnapshot = vscode.commands.registerCommand('nogit.saveSnapshot', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: 'Enter a name for this snapshot'
        });

        if (!name) return;

        const snapshot: CodeSnapshot = {
            name,
            timestamp: Date.now(),
            files: {}
        };

        // Save all open files
        for (const editor of vscode.window.visibleTextEditors) {
            const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
            snapshot.files[relativePath] = editor.document.getText();
        }

        snapshots.push(snapshot);

        // Save snapshots to disk
        try {
            fs.writeFileSync(snapshotsFile, JSON.stringify(snapshots));
            vscode.window.showInformationMessage(`Saved snapshot: ${name}`);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to save snapshot');
        }
    });

    // Restore snapshot
    let restoreSnapshot = vscode.commands.registerCommand('nogit.restoreSnapshot', async () => {
        if (snapshots.length === 0) {
            vscode.window.showInformationMessage('No snapshots available');
            return;
        }

        const items = snapshots.map(s => ({
            label: s.name,
            description: new Date(s.timestamp).toLocaleString()
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select snapshot to restore'
        });

        if (!selected) return;

        const snapshot = snapshots.find(s => s.name === selected.label);
        if (!snapshot) return;

        // Restore files
        for (const [relativePath, content] of Object.entries(snapshot.files)) {
            const workspaceFolder = vscode.workspace.workspaceFolders![0];
            const fullPath = path.join(workspaceFolder.uri.fsPath, relativePath);

            try {
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(fullPath),
                    Buffer.from(content)
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to restore ${relativePath}`);
            }
        }

        vscode.window.showInformationMessage(`Restored snapshot: ${snapshot.name}`);
    });

    context.subscriptions.push(saveSnapshot, restoreSnapshot);
}

export function deactivate() {}