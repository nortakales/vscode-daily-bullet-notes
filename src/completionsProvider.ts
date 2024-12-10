import * as vscode from 'vscode';

class DBMCompletionsProvider implements vscode.CompletionItemProvider {

    // Example https://github.com/microsoft/vscode-extension-samples/blob/main/completions-sample/src/extension.ts
    // Some helpful details: https://github.com/microsoft/vscode/issues/41022

    private completionItems = [
        {
            insertText: '+',
            filterText: 'x-/+ ',
            sortText: '1',
            completionLabel: {
                label: '+',
                detail: ' Progress'
            }
        },
        {
            insertText: 'x',
            filterText: 'x-/+ ',
            sortText: '2',
            completionLabel: {
                label: 'x',
                detail: ' Done'
            }
        },
        {
            insertText: '/',
            filterText: 'x-/+ ',
            sortText: '3',
            completionLabel: {
                label: '/',
                detail: ' Blocked'
            }
        },
        {
            insertText: '-',
            filterText: 'x-/+ ',
            sortText: '4',
            completionLabel: {
                label: '-',
                detail: ' Removed'
            }
        },
        {
            insertText: ' ',
            filterText: 'x-/+ ',
            sortText: '5',
            completionLabel: {
                label: ' ',
                detail: ' Open'
            }
        },
    ];

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {


        //   [ ]
        const minRange = Math.max(0, position.character - 2);
        const maxRange = position.character + 2;
        const characters = document.lineAt(position).text.slice(minRange, maxRange);
        if (!characters.match(/\[.?\]/)) {
            return undefined;
        }

        const prefix = document.lineAt(position).text.slice(position.character - 1, position.character);
        // If we are the start of the box or not
        const replaceStartCharacter = prefix === "[" ? position.character : position.character - 1;
        // If there is something in the box or not
        const replaceLength = characters.match(/\[.\]/) ? 1 : 0;
        const replaceRange = new vscode.Range(
            new vscode.Position(position.line, replaceStartCharacter),
            new vscode.Position(position.line, replaceStartCharacter + replaceLength)
        );

        return this.completionItems.map(item => {
            const completion = new vscode.CompletionItem(item.completionLabel, vscode.CompletionItemKind.Enum);
            completion.range = replaceRange;
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