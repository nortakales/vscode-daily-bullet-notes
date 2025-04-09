import * as vscode from 'vscode';
import { parseCursorPositionForBox } from './utilities';

class DBMCompletionsProvider implements vscode.CompletionItemProvider {

    // Example https://github.com/microsoft/vscode-extension-samples/blob/main/completions-sample/src/extension.ts
    // Some helpful details: https://github.com/microsoft/vscode/issues/41022

    private completionItems = [
        {
            insertText: '+',
            filterText: 'x-/+> ',
            sortText: '1',
            completionLabel: {
                label: '+',
                detail: ' Progress'
            }
        },
        {
            insertText: 'x',
            filterText: 'x-/+> ',
            sortText: '2',
            completionLabel: {
                label: 'x',
                detail: ' Done'
            }
        },
        {
            insertText: '/',
            filterText: 'x-/+> ',
            sortText: '3',
            completionLabel: {
                label: '/',
                detail: ' Blocked'
            }
        },
        {
            insertText: '-',
            filterText: 'x-/+> ',
            sortText: '4',
            completionLabel: {
                label: '-',
                detail: ' Removed'
            }
        },
        {
            insertText: '>',
            filterText: 'x-/+> ',
            sortText: '5',
            completionLabel: {
                label: '>',
                detail: ' Tomorrow'
            }
        },
        {
            insertText: ' ',
            filterText: 'x-/+> ',
            sortText: '6',
            completionLabel: {
                label: ' ',
                detail: ' Open'
            }
        },
    ];

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {

        const parsedBox = parseCursorPositionForBox(position, document);
        if (!parsedBox) {
            return undefined;
        }

        // TODO if we want to support changing tasks to notes and vice versa, insert text needs to be dynamic
        // and range needs to be appropriately modified

        return this.completionItems.map(item => {
            const completion = new vscode.CompletionItem(item.completionLabel, vscode.CompletionItemKind.Enum);
            completion.range = parsedBox.innerBoxRange;
            completion.insertText = item.insertText;
            completion.filterText = item.filterText;
            completion.sortText = item.sortText;
            return completion;
        });
    }

    resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        throw new Error('Method not implemented.');
    }
}

export default DBMCompletionsProvider;