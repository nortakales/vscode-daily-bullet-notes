# Change Log

## 0.3.0 - 2026-10-04

* Fixed parent task being marked complete `[x]` or removed `[-]` when a sub-task was planned for tomorrow `[>]`, which also orphaned that sub-task on the next day
* Fixed parent task not updating when a sub-task was marked removed `[-]`
* Fixed tasks indented under a plain note being treated as sub-tasks of the task above the note
* Fixed parent task statuses never updating for a day whose first task was indented
* Fixed sub-tasks being ignored at an in-between indent level, or nested under the wrong task when mixing tabs and spaces
* Parent task status now updates when sub-tasks are deleted, cut or pasted
* Fixed status updates sometimes being written to the wrong file if you switched editors right after an edit
* Automatic `[ ]` boxes, status updates and click-to-select in boxes now only happen in Daily Bullet Notes files
* `Add Today` no longer carries over notes or sub-tasks indented under a complete or removed task, and carries over a top level note if open tasks are indented under it
* Clear error message when your file is missing a valid `Daily Log` header box (or has no days), with an option to start a new file
* Renamed `New DBM File` to `Initialize New DBM File`, added it to the Daily Bullet Notes menu, and added a `[>]` example to the template

## 0.2.0 - 2026-03-17

* Under the hood performance improvements

## 0.1.5 - 2025-09-11

* No functionality changes, just some maintenance
  * Removed error from resolveCompletionItem which should clean up extension host logs
  * Updated dependencies
  * Removed quickstart readme
  * Set watch task to run on folder open

## 0.1.4 - 2025-04-09

* Added support for `[>]` which is a task you added but had no plan to work on until the next day
* Adjusted some textmate scopes to adjust some colors

## 0.1.3 - 2025-02-21

* Fixed bug where parent task was not always updating to progress `[+]`

## 0.1.2 - 2025-02-21

* Fixed bug when pressing enter in the middle of a task title added a box after the text on the new line instead of before it
* Fixed bug where subtasks like `[ ]` and `[]` caused parent task to be `[x]`
* Changed behavior such that if a sub-task was completed `[x]`, but some other sub-tasks are not yet completed, parent task is marked as progress `[+]`

## 0.1.0 - 2024-12-14

* First minor version, ready for prime time!
* Added a setting to control whether or not parent tasks should have their status updated automatically
* Maybe enabled this as a web extension?

## 0.0.6 - 2024-12-12

* Fixed bug when starting a new line in CRLF mode would not add a `[ ]` box
* Complete rewrite of code that updates a parent task's status. Now the entire day you have just modified will have all statuses updated as appropriate based on child tasks. This still needs some work though, or at the very least some setting(s) to control or turn off the behavior if it is not desired.

## 0.0.5 - 2024-12-11

* Adding a new line after an existing task will start the line with a `[ ]` box
  * That box can then be removed entirely via `Backspace`
  * Or indented via `Tab` and unindented via `Shift + Tab`
* Modifying the status of a `[ ]` box which is a subtask will re-calculate the parent task's status
  * For example, if all sub-tasks are complete, the parent task will also be marked complete
  * This feature still needs work - it does not recurse up to parent-parent tasks, and does not recalculate task status when adding or removing tasks yet

## 0.0.4 - 2024-12-10

* Fixed bug where folding was not provided on an untitled/yet-to-be-saved editor even if the language was set to `daily-bullet-notes`
* Added auto completion options when cursor is within a `[ ]` box
  * This can be triggered normally via `Ctrl + Space`
  * Or, if you mouse click within the box, auto complete will pop up automatically, and the symbol within the box will be selected so you can easily change it
* Added `Add Today + Standup View` command for the perfect one-click action each morning

## 0.0.3 - 2024-12-5

* Fixed bug where `[x]` or `[-]` sub-tasks were not removed on next day
* `[ ]` is now highlighted just like `[]`
* Added [New DBM File](command:daily-bullet-notes.newFile) command which will create a new file with a template to get new users started
* Readme updates to get new users started

## 0.0.2 - 2024-12-3

* Updated readme with extension overview
* Progress/blocked/etc markers are removed from task boxes when copied to today so your new day starts with a clean slate

## 0.0.1 - 2024-12-1

* Initial version - not yet complete, many bugs