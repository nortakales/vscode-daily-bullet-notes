import * as vscode from 'vscode';

class DBMUIElements {

    public constructor(context: vscode.ExtensionContext) {
        this.init(context);
    }

    init(context: vscode.ExtensionContext) {
        this.createStatusBarIcons(context);
        this.registerCommands(context);
        this.updateView();
    }

    private standupQuipShortcut!: vscode.StatusBarItem;

    private registerCommands(context: vscode.ExtensionContext) {
        this.registerCommand(context, "work-hacks.openStandupQuip", () => {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://quip-amazon.com/00tbAVtdzczD'));
        });
    }

    updateView() {
        if ("c:\\Users\\nicholao\\Documents\\TextFiles\\log.txt" === vscode.window.activeTextEditor?.document.fileName) {
            // Actually went with the nav button instead, so always hide
            this.standupQuipShortcut.hide();
        } else {
            this.standupQuipShortcut.hide();
        }
    }

    private createStatusBarIcons(context: vscode.ExtensionContext) {

        this.standupQuipShortcut = this.createStatusBarItem(
            context,
            vscode.StatusBarAlignment.Left,
            1,
            "work-hacks.openStandupQuip", // https://code.amazon.com/packages/Viceroy/blobs/mainline/--/src/lib/code.amazon.com/OpenCodeBrowserCommand.ts
            `$(link-external)`,
            "Goto Standup Quip");
        ;
    }

    private registerCommand(
        context: vscode.ExtensionContext,
        commandName: string,
        command: string | ((...args: any[]) => any)) {

        let commandToExecute: ((...args: any[]) => any);
        if (typeof command === "string") {
            commandToExecute = () => {
                vscode.commands.executeCommand(command);
            };
        } else {
            commandToExecute = command;
        }

        const disposable = vscode.commands.registerCommand(commandName, commandToExecute);

        context.subscriptions.push(disposable);
    }

    private createStatusBarItem(
        context: vscode.ExtensionContext,
        alignment: vscode.StatusBarAlignment,
        priority: number,
        command: string,
        label: string,
        tooltip: string): vscode.StatusBarItem {

        const statusBarItem = vscode.window.createStatusBarItem(alignment, priority);
        statusBarItem.command = command;
        statusBarItem.text = label;
        statusBarItem.tooltip = tooltip;

        context.subscriptions.push(statusBarItem);

        return statusBarItem;
    }
}

export default DBMUIElements;