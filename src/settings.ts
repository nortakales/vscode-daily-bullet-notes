import * as vscode from "vscode";

export function automaticStatusUpdates() {
    return vscode.workspace.getConfiguration().get("daily-bullet-notes.automaticStatusUpdates", true);
}