import { addToday } from './addToday';
import { standupView } from './standupView';

export async function addTodayAndStandupView() {
    if (await addToday()) {
        await standupView();
    }
}
