# Daily Bullet Notes

![ ](images/icon-256.png)

This VSCode extension is designed specifically around my way of tracking daily tasks at work. It is pretty close to the popular "Bullet Journal" method. I started my particular method in 2016, and it has worked for nearly a decade at this point. This method, which I'll describe below, is particularly useful at helping me track everything I need to do, but also all of the things I have done. It's a good resource for your daily standup meeting, and also to track what you worked on throughout an entire year for a yearly self review. Or use it outside of work to keep track of personal tasks too.

Here is an example
```
+----------------------------------------+
|                  2024                  |
+----------------------------------------+
+----------------------------------------+
|                December                |
+----------------------------------------+
12/4 -------------------------------------
here is whatever you did yesterday

12/5 -------------------------------------
and this is today
[x] this task is complete
[/] this task is blocked, you are waiting on someone or something before more progress can be made
[-] this task is either no longer relevant or tracked by someone else now
[+] you made some progress on this task today, but it isn't done yet
[ ] this task is ready and waiting to be worked on
[>] this task was added today, but you plan to work on it tomorrow
Here is a quick note you took about the day, like you took the afternoon off or attended an event

+----------------------------------------+
|              Example List              |
+----------------------------------------+
This is an example where you might keep things like your career goals,
longstanding tasks on your backburner, ideas for an upcoming hackathon,
some inspirational quotes, or even just your last meeting notes.
You can create many lists like this, and they wil always live just below
your latest daily entry.
```

Here is how my method works:
1. Each day contains a list of tasks. This list should contain everything I plan to do, everything I have done, and possibly some tasks I know I won't get to yet but still want to keep track of on a daily basis.
2. Each task starts with a box like `[ ]`, and what's inside the box depends on the task's status:
   1. `[ ]` - empty box means this task has not been touched today and is open to work on
   2. `[x]` - done
   3. `[+]` - I worked on it, but it is not done yet
   4. `[/]` - task is blocked, I cannot make progress
   5. `[-]` - task is no longer needed, or I'm no longer tracking it
   6. `[>]` - task was added today, but no plan to work on it until tomorrow
3. For each task I may have some notes or sub-tasks indented on the next lines. Sub-tasks may also have their own status box.
4. As I work on tasks throughout the day, I update their status. If I work on something unplanned, I add it to my list with the appropriate status.
5. At the start of each day, I copy the previous day's list. I remove tasks that are done `[x]` or no longer needed `[-]`, and keep all other tasks. All these tasks will start with an empty `[ ]`, and I will immediately update their status as needed (e.g. if I already know something is blocked for the day).

Below these daily tasks, I also keep a few lists or notes. These are just small lists meant to help me track things that might not make sense in the context of a particular day. Examples are tasks on my "backburner", ideas for upcoming hackathons, career goals or inspirational quotes.

The main benefits of this method to me are:
1. **Simple** - no fancy apps, just a text file
2. **Searchable** - just hit Ctrl+F and find anything
3. **Fast** - no fancy process or system to get in your way
4. **Scalable** - archive older years in a separate file to keep your main log small
5. **Portable** - use any service to sync your file wherever you desire

## Getting Started

1. Get this extension
2. Run [New DBM File](command:daily-bullet-notes.newFile) to create a new file from a template that will get you started

## Extension Features

1. **Syntax highlighting** - year/month/day headers, list headers and task boxes are all colored
2. **Folding (collapsing)** - fold years/months/days and lists
3. **Commands** - a bunch of built in commands to help manage your tasks/notes

## Commands

| Title                    | Command                                     | Description                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add Today + Standup View | `daily-bullet-notes.addTodayAndStandupView` | I start every day with this command. As the name suggests, it is simply a combination of `Add Today` and `Standup View`. Read those descriptions for more info.                                          |
| Add Today                | `daily-bullet-notes.addToday`               | Copies the previous day to a new day with today's date, preserving all tasks that are not complete `[x]` or removed `[-]` and any sub-tasks/notes for those tasks. Top level notes are not carried over. |
| Standup View             | `daily-bullet-notes.standupView`            | Collapses the entire document except for the two most recent days (usually this would be today and yesterday).                                                                                           |
| Add New List             | `daily-bullet-notes.addNewList`             | Shortcut for adding a new list at the bottom of your document with a nicely formatted header box.                                                                                                        |
| New DBM File             | `daily-bullet-notes.newFile`                | A quick way for new users to get started with a template.                                                                                                                                                |

## Settings

| Setting                  | Key                                         | Default | Description                                                                                                                                                  |
| ------------------------ | ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automatic Status Updates | `daily-bullet-notes.automaticStatusUpdates` | `true`  | Update all task statuses automatically based on sub-tasks. *Note: this will happen only within the particular day you are editing, not the entire document.* |

## Release Notes

See [Change Log](./CHANGELOG.md)

## Known Issues

* Many edge cases are not handled if your file is not formatted well. If you let the extension handle adding new days, you'll be fine.
* Days in the future are NOT handled yet. If you add today, it will always assume today should be at the very bottom.

## Upcoming Features (aka Todo List)

* [ ] goto today command (standup view is basically the same, and complete)
* [ ] archive previous year command
* [ ] archive previous month command
* [ ] auto archive setting
* [ ] archive location setting
* [ ] daily log location setting
* [x] show month/year text when folded
* [x] add new list command
* [ ] collapse all previous months
* [ ] collapse all previous years
* [x] collapse all but today and yesterday (standup view)
* [ ] setting to include month/day or just day in daily header
* [ ] set width of headers
* [ ] consider what happens if you skipped some days
* [ ] command to add vacation/sick days
* [x] command to start a brand new dbm file from a template
* [ ] formatter (remove extra empty lines, format headers and boxes to correct width, set special header on today, indenting?)
* [ ] add tomorrow command
* [ ] setting to skip weekends for add tomorrow
* [ ] next day command with possible sub-commands:
    * add current day (skip missing days since last day)
    * add next day after last day
    * add sick/vacation day
* [ ] support days in the future
* [x] update main task box based on sub-task status (sort of complete, may be bugs or behavior tweaks needed)
* [ ] Readme updates
  * [ ] Include more examples
  * [x] getting started section
  * [x] settings/commands tables
* [ ] ability to add recurring todos on a specific day of week or date or maybe cadence, or even just once on a specific date
* [x] bug: x and - is not removed if indented, but others are cleared
* [x] add [] when adding new line after a task
  * [x] backspace should then clear entire box
  * [x] tab should indent it
* [x] bug: syntax highlight [ ]
* [ ] preference for [] vs [ ]
* [x] refactor commands into separate classes
* [ ] auto format a box if you have a space and enter an x, like [ x] or [x ]
* [x] bug? folding is not provided on brand new unsaved file
* [x] auto highlight contents of [ ] when clicking inside so you can easily replace via keyboard
* [x] bring up auto complete when cursor is inside of [ ]
* [x] ctrl + space auto complete when inside of [ ]
* [x] new day + standup view command
* [ ] enable this as a web extension
* [ ] click to change a task into a note (with a bullet) or vice versa
* [x] settings to control updating parent task status
* [ ] when adding a newline, bring up the auto-complete for task status with open and bullet note at the top