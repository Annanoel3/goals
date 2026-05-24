import AddTask from './pages/AddTask';
import DeleteAccount from './pages/DeleteAccount';
import DeleteData from './pages/DeleteData';
import Home from './pages/Home';
import ParkingLot from './pages/ParkingLot';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Profile from './pages/Profile';
import ProfileSettings from './pages/ProfileSettings';
import Progress from './pages/Progress';
import SupportSpace from './pages/SupportSpace';
import TaskNotification from './pages/TaskNotification';
import Tasks from './pages/Tasks';
import TermsAndConditions from './pages/TermsAndConditions';
import Goals from './pages/Goals';
import Planner from './pages/Planner';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AddTask": AddTask,
    "DeleteAccount": DeleteAccount,
    "DeleteData": DeleteData,
    "Home": Home,
    "ParkingLot": ParkingLot,
    "PrivacyPolicy": PrivacyPolicy,
    "Profile": Profile,
    "ProfileSettings": ProfileSettings,
    "Progress": Progress,
    "SupportSpace": SupportSpace,
    "TaskNotification": TaskNotification,
    "Tasks": Tasks,
    "TermsAndConditions": TermsAndConditions,
    "Goals": Goals,
    "Planner": Planner,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};