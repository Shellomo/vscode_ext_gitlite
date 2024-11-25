import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface Snapshot {
    name: string;
    date: string;
    files: string[];
}

export function activate(context: vscode.ExtensionContext) {
    // Create backup directory if it doesn't exist
    const createBackupDir = (workspacePath: string) => {
        const backupPath = path.join(workspacePath, '.backup');
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath);
        }
        return backupPath;
    };

    // Load snapshots metadata
    const loadSnapshots = (workspacePath: string): Snapshot[] => {
        const metadataPath = path.join(workspacePath, '.backup', 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        }
        return [];
    };

    // Save snapshots metadata
    const saveSnapshots = (workspacePath: string, snapshots: Snapshot[]) => {
        const metadataPath = path.join(workspacePath, '.backup', 'metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(snapshots, null, 2));
    };

    // Create snapshot command
    let createSnapshotCommand = vscode.commands.registerCommand('no-git.createSnapshot', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const backupPath = createBackupDir(workspacePath);
        const snapshots = loadSnapshots(workspacePath);

        if (snapshots.length >= 10) {
            vscode.window.showErrorMessage('Maximum number of snapshots (10) reached. Please delete some snapshots first.');
            return;
        }

        const snapshotName = await vscode.window.showInputBox({
            prompt: 'Enter snapshot name',
            placeHolder: 'e.g., before-refactoring'
        });

        if (!snapshotName) {
            return;
        }

        // Create snapshot directory
        const snapshotPath = path.join(backupPath, snapshotName);
        fs.mkdirSync(snapshotPath);

        // Copy all files
        const files: string[] = [];
        const copyFiles = (dirPath: string, relativePath: string = '') => {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const relPath = path.join(relativePath, entry.name);

                if (entry.isDirectory()) {
                    if (entry.name !== '.backup' && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                        const targetDir = path.join(snapshotPath, relPath);
                        fs.mkdirSync(targetDir, { recursive: true });
                        copyFiles(fullPath, relPath);
                    }
                } else {
                    const targetFile = path.join(snapshotPath, relPath);
                    fs.copyFileSync(fullPath, targetFile);
                    files.push(relPath);
                }
            }
        };

        copyFiles(workspacePath);

        // Update metadata
        snapshots.push({
            name: snapshotName,
            date: new Date().toISOString(),
            files
        });
        saveSnapshots(workspacePath, snapshots);

        vscode.window.showInformationMessage(`Snapshot "${snapshotName}" created successfully`);
    });

    // Restore snapshot command
    let restoreSnapshotCommand = vscode.commands.registerCommand('no-git.restoreSnapshot', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const snapshots = loadSnapshots(workspacePath);

        if (snapshots.length === 0) {
            vscode.window.showErrorMessage('No snapshots available');
            return;
        }

        const snapshotItems = snapshots.map(s => ({
            label: s.name,
            description: new Date(s.date).toLocaleString()
        }));

        const selected = await vscode.window.showQuickPick(snapshotItems, {
            placeHolder: 'Select snapshot to restore'
        });

        if (!selected) {
            return;
        }

        const snapshot = snapshots.find(s => s.name === selected.label);
        if (!snapshot) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to restore snapshot "${snapshot.name}"? This will overwrite current files.`,
            'Yes', 'No'
        );

        if (confirm !== 'Yes') {
            return;
        }

        const snapshotPath = path.join(workspacePath, '.backup', snapshot.name);

        // Restore files
        for (const file of snapshot.files) {
            const sourcePath = path.join(snapshotPath, file);
            const targetPath = path.join(workspacePath, file);

            // Ensure target directory exists
            const targetDir = path.dirname(targetPath);
            fs.mkdirSync(targetDir, { recursive: true });

            // Copy file
            fs.copyFileSync(sourcePath, targetPath);
        }

        vscode.window.showInformationMessage(`Snapshot "${snapshot.name}" restored successfully`);
    });

    // List snapshots command
    let listSnapshotsCommand = vscode.commands.registerCommand('no-git.listSnapshots', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const snapshots = loadSnapshots(workspacePath);

        if (snapshots.length === 0) {
            vscode.window.showInformationMessage('No snapshots available');
            return;
        }

        // Create QuickPick items with detailed information
        const items = snapshots.map(s => {
            const date = new Date(s.date);
            const timeAgo = getTimeAgo(date);
            return {
                label: s.name,
                description: `${timeAgo}`,
                detail: `Created: ${date.toLocaleString()} • Files: ${s.files.length}`,
            };
        });

        // Show QuickPick with snapshot list
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a snapshot to view details',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const snapshot = snapshots.find(s => s.name === selected.label);
            if (snapshot) {
                // Show additional details about the selected snapshot
                const details = [
                    `Name: ${snapshot.name}`,
                    `Created: ${new Date(snapshot.date).toLocaleString()}`,
                    `Total Files: ${snapshot.files.length}`,
                    '',
                    'Files:',
                    ...snapshot.files.slice(0, 10).map(f => `• ${f}`),
                    snapshot.files.length > 10 ? `\n... and ${snapshot.files.length - 10} more files` : ''
                ].join('\n');

                vscode.window.showInformationMessage('Snapshot Details',
                    { modal: true, detail: details },
                    'Restore this snapshot'
                ).then(selection => {
                    if (selection === 'Restore this snapshot') {
                        vscode.commands.executeCommand('no-git.restoreSnapshot');
                    }
                });
            }
        }
    });

    // Helper function to format relative time
    function getTimeAgo(date: Date): string {
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60
        };

        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(diffInSeconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
            }
        }

        return 'Just now';
    }

    context.subscriptions.push(createSnapshotCommand);
    context.subscriptions.push(restoreSnapshotCommand);
    context.subscriptions.push(listSnapshotsCommand);
}

export function deactivate() {}