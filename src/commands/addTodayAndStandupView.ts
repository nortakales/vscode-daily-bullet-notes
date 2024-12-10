import { addToday } from './addToday';
import { standupView } from './standupView';

export async function addTodayAndStandupView() {
    await addToday();
    standupView();
}
