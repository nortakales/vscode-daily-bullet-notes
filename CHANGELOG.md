# Change Log

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