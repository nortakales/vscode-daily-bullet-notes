# Daily Bullet Notes

This VSCode extension is designed specifically around my way of tracking daily tasks at work. It is pretty close to "Bullet Journalling" I believe. I started this method in 2016, and it has worked for nearly a decade at this point. This method, which I'll describe below, is particularly useful at helping me track everything I need to do, but also all of the things I have done as well. It's a good resource for your daily standup, and also to remind you what you worked on throughout an entire year for a yearly self review.

Here is how my method works:
1. Each day contains a list of tasks. This list should contain everything I plan to do, everything I have done, and possibly some tasks I know I won't get to yet but still want to keep track of on a daily basis.
2. Each task starts with a box like `[ ]`, and what's inside the box depends on the task's status:
   1. `[ ]` - empty box means this task has not been touched today and is open to work on
   2. `[x]` - done
   3. `[+]` - I worked on it, but it is not done yet
   4. `[/]` - task is blocked, I cannot make progress
   5. `[-]` - task is no longer needed, or I'm no longer tracking it
3. For each task I may have some notes or sub-tasks indented on the next lines. Sub-tasks may also have their own status box.
4. As I work on tasks throughout the day, I update their status. If I work on something unplanned, I add it to my list with the appropriate status.
5. At the start of each day, I copy the previous day's list. I remove tasks that are done `[x]` or no longer needed `[-]`, and keep all other tasks. All these tasks will start with an empty `[ ]`, and I will immediately update their status as needed (e.g. if I already know something is blocked for the day).

Below these daily tasks, I also keep a few lists. These are just small lists meant to help me track things that might not make sense in the context of a particular day. Examples are tasks on my "backburner", ideas for upcoming hackathons, or career goals.

## Features

TBD


## Extension Settings

None yet, there will be eventually.

## Known Issues

* Many edge cases are not handled if your file is not formatted well. If you let the extension handle formatting (other than adding new tasks/notes in a day), you'll be fine.
* Days in the future are NOT handled yet. If you add today, it will always assume today should be at the very bottom.

## Change Log

### 0.0.1

Initial version - not yet complete, many bugs

# Upcoming Features (aka Todo List)

* [] goto today command (standup view is basically the same, and complete)
* [] archive previous year command
* [] archive previous month command
* [] auto archive setting
* [] archive location setting
* [] daily log location setting
* [x] show month/year text when folded
* [x] add new list command
* [] collapse all previous months
* [] collapse all previous years
* [x] collapse all but today and yesterday (standup view)
* [] setting to include month/day or just day in daily header
* [] set width of headers
* [] consider what happens if you skipped some days
* [] command to add vacation/sick days
* [] command to start a brand new dbm file from a template
* [] formatter (remove extra empty lines, format headers and boxes to correct width, set special header on today, indenting?)
* [] add tomorrow command
* [] setting to skip weekends for add tomorrow
* [] next day command with possible sub-commands:
    * add current day (skip missing days since last day)
    * add next day after last day
    * add sick/vacation day
* [] support days in the future
* [] update main task box based on sub-task status