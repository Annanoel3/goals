import React, { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  LayoutDashboard,
  ListTodo,
  Timer,
  MessageCircleHeart,
  Lightbulb,
  Sun,
  Moon,
  TrendingUp,
  Share2,
  Bug,
  LogOut,
  User as UserIcon,
  Trophy,
  Users,
  ChevronDown,
  ChevronRight,
  Settings,
  MessageCircle,
  Bell,
  Sparkles,
  Mic,
  HelpCircle,
  Shield,
  ArrowLeft,
  Target,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import UniversalVoiceAssistant from "./components/shared/UniversalVoiceAssistant";
import MicrophonePermissionCheck from "./components/shared/MicrophonePermissionCheck";
import AppOpenHabitCheck from "./components/goals/AppOpenHabitCheck";
import { base44 } from "@/api/base44Client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import OneSignalInit from "./components/shared/OneSignalInit";
import {
  Tooltip,
  TooltipProvider,
} from "@/components/ui/tooltip";
import EasterEggVideo from "./components/shared/EasterEggVideo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function LayoutContent({ children, currentPageName, user, authCheckComplete }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('adhd_theme') || 'minimalist';
  });


  useEffect(() => {
    localStorage.setItem('adhd_theme', theme);
  }, [theme]);






  // Android back button handler
  useEffect(() => {
    // Check if Capacitor is available (only in native builds)
    if (typeof window !== 'undefined' && window.Capacitor) {
      const setupBackButton = async () => {
        try {
          const { App } = window.Capacitor.Plugins;
          
          App.addListener('backButton', ({ canGoBack }) => {
            if (location.pathname === createPageUrl('Home') || !canGoBack) {
              App.exitApp();
            } else {
              navigate(-1);
            }
          });

          return () => {
            App.removeAllListeners();
          };
        } catch (error) {
          console.log('Capacitor App plugin not available:', error);
        }
      };

      setupBackButton();
    }
  }, [location.pathname, navigate]);

  const toggleTheme = () => {
    setTheme(prev => {
      let nextTheme;
      if (prev === 'minimalist') {
        nextTheme = 'dark';
      } else if (prev === 'dark') {
        nextTheme = 'colorful';
      } else {
        nextTheme = 'minimalist';
      }
      return nextTheme;
    });
  };

  const handleLogout = async () => {
    try {
      await base44.auth.logout();
      window.location.reload();
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };



  const getBackgroundClass = () => {
    if (theme === 'dark') return 'bg-[#0a0a0b]';
    if (theme === 'minimalist') return 'bg-gradient-to-br from-stone-50 via-sage-50 to-stone-100';
    if (theme === 'colorful') return 'bg-gradient-to-br from-purple-200 via-pink-200 to-blue-200';
    return 'bg-gradient-to-br from-stone-50 via-sage-50 to-stone-100';
  };



  const handleNavClick = () => {
    setOpenMobile(false);
  };

  const mainMenuPages = [
    createPageUrl("Home"),
    "/",
    createPageUrl("Planner"),
    createPageUrl("Goals"),
    createPageUrl("Progress"),
    createPageUrl("SupportSpace"),
    createPageUrl("ParkingLot"),
    createPageUrl("ProfileSettings"),
  ];

  const isMainMenuPage = mainMenuPages.includes(location.pathname);

  const navigationItems = [
    {
      title: "Home",
      url: createPageUrl("Home"),
      icon: LayoutDashboard,
    },
    {
      title: "Planner",
      url: createPageUrl("Planner"),
      icon: Sparkles,
    },
    {
      title: "Goals",
      url: createPageUrl("Goals"),
      icon: Target,
    },
    {
      title: "Progress",
      url: createPageUrl("Progress"),
      icon: TrendingUp,
    },
    {
      title: "Parking Lot",
      url: createPageUrl("ParkingLot"),
      icon: Lightbulb,
    },
  ];

  return (
    <div
      className={`min-h-screen flex w-full overflow-x-hidden ${getBackgroundClass()}`}
      style={{
        paddingTop: 'env(safe-area-inset-top)'
      }}
    >
      {user && <OneSignalInit user={user} />}
      {user && <AppOpenHabitCheck user={user} />}
      <EasterEggVideo />

      <style>{`
          ${theme === 'minimalist' ? `
            :root {
              --primary: 142 76% 36%;
              --primary-foreground: 0 0% 100%;
              --secondary: 40 20% 96%;
              --accent: 142 30% 85%;
              --muted: 40 10% 95%;
              --card: 0 0% 100%;
              --background: 0 0% 100%;
              --foreground: 0 0% 9%;
              --border: 0 0% 91%;
              --input: 0 0% 9%;
              --ring: 142 76% 36%;
            }
            .sage-50 { background-color: #f0f4f1; }
          ` : theme === 'dark' ? `
            :root {
              --primary: 142 76% 45%;
              --primary-foreground: 0 0% 100%;
              --secondary: 240 4% 12%;
              --accent: 240 4% 20%;
              --muted: 240 4% 15%;
              --card: 17 20% 12%;
              --card-foreground: 0 0% 98%;
              --popover: 17 20% 12%;
              --popover-foreground: 0 0% 98%;
              --background: 17 20% 8%;
              --foreground: 0 0% 98%;
              --border: 240 4% 18%;
              --input: 17 20% 12%;
              --ring: 142 76% 45%;
            }
          ` : theme === 'colorful' ? `
            :root {
              --primary: 271 91% 65%;
              --primary-foreground: 0 0% 100%;
              --secondary: 33 100% 95%;
              --accent: 173 80% 70%;
              --muted: 271 20% 95%;
              --card: 0 0% 100%;
              --background: 0 0% 100%;
              --foreground: 0 0% 9%;
              --border: 0 0% 91%;
              --input: 0 0% 9%;
              --ring: 271 91% 65%;
            }
          ` : ''}

          html, body {
            overflow-x: hidden;
            width: 100%;
            max-width: 100vw;
          }

          * {
            box-sizing: border-box;
          }
        `}</style>

      <TooltipProvider>
          {/* Permanent sidebar — always visible on md+ screens */}
          <div className={`hidden md:flex flex-col w-64 flex-shrink-0 border-r z-10 min-h-screen ${
            theme === 'dark'
              ? 'bg-gray-950 border-gray-800'
              : theme === 'colorful'
                ? 'bg-gradient-to-b from-purple-100/90 to-pink-100/90 backdrop-blur-sm border-purple-300/50'
                : 'border-gray-200/50 backdrop-blur-sm bg-white/80'
          }`}>
            {/* Header */}
            <div className={`${
              theme === 'dark' ? 'bg-gray-900' : theme === 'colorful' ? 'bg-gradient-to-r from-purple-200 to-pink-200' : ''
            }`} style={{
              paddingTop: 'max(3rem, calc(2rem + env(safe-area-inset-top)))',
              paddingLeft: '1.5rem',
              paddingRight: '1.5rem',
              paddingBottom: '1.5rem'
            }}>
              <div className="flex items-center gap-3">
                {user && user.profile_picture_url ? (
                  <Link to={createPageUrl("Profile")}>
                    <img src={user.profile_picture_url} alt="Profile" className="w-10 h-10 rounded-full object-cover" />
                  </Link>
                ) : (
                  <Link to={createPageUrl("Profile")}>
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-white text-xl ${
                      theme === 'dark' ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-green-600 to-green-700'
                    }`}>
                      {user?.full_name?.charAt(0)?.toUpperCase() || 'A'}
                    </div>
                  </Link>
                )}
                <Link to={createPageUrl("Home")}>
                  <div>
                    <h2 className={`font-bold text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{user?.full_name || 'Goals.'}</h2>
                    <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>You've got this</p>
                  </div>
                </Link>
              </div>
            </div>

            {/* Nav */}
            <div className={`flex-1 ${theme === 'dark' ? 'bg-gray-950' : theme === 'colorful' ? 'bg-gradient-to-b from-purple-100/80 to-pink-100/80' : ''}`}
              style={{ paddingTop: '2.5rem', paddingLeft: '0.75rem', paddingRight: '0.75rem' }}>
              <nav className="space-y-1">
                {navigationItems.map((item) => (
                  <Link key={item.title} to={item.url} className="block w-full">
                    <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${
                      location.pathname === item.url
                        ? theme === 'minimalist' ? 'bg-green-50 text-green-700 font-medium'
                          : theme === 'dark' ? 'bg-gray-800 text-white font-medium'
                          : theme === 'colorful' ? 'bg-gradient-to-r from-violet-300 to-pink-300 text-gray-900 font-medium shadow-md'
                          : 'bg-gradient-to-r from-purple-100 to-orange-100 text-purple-700 font-medium'
                        : theme === 'dark' ? 'text-gray-400 hover:bg-gray-800 hover:text-white'
                          : theme === 'colorful' ? 'text-gray-900 hover:bg-purple-200/60 font-medium'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}>
                      <item.icon className="w-5 h-5 flex-shrink-0" />
                      <span>{item.title}</span>
                    </div>
                  </Link>
                ))}
              </nav>
            </div>

            {/* Footer */}
            <div className={`space-y-3 ${
              theme === 'dark' ? 'bg-gray-950' : theme === 'colorful' ? 'bg-gradient-to-t from-purple-200 to-pink-100' : ''
            }`} style={{
              paddingTop: '1rem', paddingLeft: '1rem', paddingRight: '1rem',
              paddingBottom: 'max(4rem, calc(2rem + env(safe-area-inset-bottom)))'
            }}>
              <Button variant="outline" onClick={toggleTheme} className={`w-full flex items-center justify-center gap-2 rounded-xl ${
                theme === 'dark' ? 'border-gray-700 hover:bg-gray-800 text-gray-300 bg-transparent'
                  : theme === 'colorful' ? 'bg-gradient-to-r from-violet-400 to-pink-400 hover:from-violet-500 hover:to-pink-500 text-white font-medium shadow-md' : ''
              }`}>
                {theme === 'minimalist' ? <><Sun className="w-4 h-4" /><span>Light Theme</span></>
                  : theme === 'dark' ? <><Moon className="w-4 h-4" /><span>Dark Theme</span></>
                  : <><Sparkles className="w-4 h-4" /><span>Colorful Theme</span></>}
              </Button>
              <Button variant="outline" onClick={() => navigate('/settings')} className={`w-full flex items-center justify-center gap-2 rounded-xl ${
                theme === 'dark' ? 'border-gray-700 hover:bg-gray-800 text-gray-300 bg-transparent'
                  : theme === 'colorful' ? 'bg-gradient-to-r from-violet-400 to-pink-400 hover:from-violet-500 hover:to-pink-500 text-white font-medium shadow-md' : ''
              }`}>
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </Button>
            </div>
          </div>

          {/* Mobile drawer sidebar (shadcn) */}
          <Sidebar collapsible="offcanvas" className={`md:hidden border-r ${
            theme === 'dark' ? 'bg-gray-950 border-gray-800'
              : theme === 'colorful' ? 'bg-gradient-to-b from-purple-100/90 to-pink-100/90 border-purple-300/50'
              : 'border-gray-200/50 bg-white/80'
          }`}>
            <SidebarHeader style={{ paddingTop: '3rem', paddingLeft: '1.5rem', paddingRight: '1.5rem', paddingBottom: '1.5rem' }}>
              <div className="flex items-center gap-3">
                <Link to={createPageUrl("Profile")} onClick={handleNavClick}>
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-white text-xl ${
                    theme === 'dark' ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-green-600 to-green-700'
                  }`}>{user?.full_name?.charAt(0)?.toUpperCase() || 'A'}</div>
                </Link>
                <div>
                  <h2 className={`font-bold text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{user?.full_name || 'Goals.'}</h2>
                  <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>You've got this</p>
                </div>
              </div>
            </SidebarHeader>
            <SidebarContent style={{ paddingTop: '2rem', paddingLeft: '0.75rem', paddingRight: '0.75rem' }}>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu className="space-y-1">
                    {navigationItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <Link to={item.url} onClick={handleNavClick} className="block w-full">
                          <SidebarMenuButton className={`rounded-xl w-full ${
                            location.pathname === item.url
                              ? theme === 'dark' ? 'bg-gray-800 text-white font-medium' : 'bg-green-50 text-green-700 font-medium'
                              : theme === 'dark' ? 'text-gray-400 hover:bg-gray-800 hover:text-white' : 'text-gray-700 hover:bg-gray-50'
                          }`}>
                            <div className="flex items-center gap-3 py-2">
                              <item.icon className="w-5 h-5 flex-shrink-0" />
                              <span>{item.title}</span>
                            </div>
                          </SidebarMenuButton>
                        </Link>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter style={{ padding: '1rem', paddingBottom: '3rem' }} className="space-y-3">
              <Button variant="outline" onClick={toggleTheme} className="w-full rounded-xl gap-2">
                {theme === 'dark' ? <><Moon className="w-4 h-4" /><span>Dark Theme</span></> : <><Sun className="w-4 h-4" /><span>Light Theme</span></>}
              </Button>
              <Button variant="outline" onClick={() => { navigate('/settings'); handleNavClick(); }} className="w-full rounded-xl gap-2">
                <Settings className="w-4 h-4" /><span>Settings</span>
              </Button>
            </SidebarFooter>
          </Sidebar>

          <main className="flex-1 flex flex-col min-w-0 min-h-screen relative z-10">
            <header className={`backdrop-blur-md border-b px-6 sticky top-0 z-10 ${
              theme === 'dark'
                ? 'bg-gray-900/90 border-gray-700'
                : theme === 'colorful'
                  ? 'bg-gradient-to-r from-purple-200/80 via-pink-200/80 to-blue-200/80 border-purple-300/50'
                  : 'bg-white/60 border-gray-200/50'
            }`} style={{
              paddingTop: 'max(1rem, calc(0.5rem + env(safe-area-inset-top, 0px)))',
              paddingBottom: '1rem'
            }}>
              <div className="flex items-center gap-4">
                <SidebarTrigger asChild>
                  <Button variant="ghost" className={`md:hidden h-14 w-14 p-0 rounded-xl transition-colors duration-200 flex items-center justify-center ${
                    theme === 'dark' ? 'hover:bg-gray-800 text-white' : 'hover:bg-gray-100'
                  }`}>
                    <LayoutDashboard className="w-7 h-7" />
                  </Button>
                </SidebarTrigger>
                <h1 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Goals.</h1>
              </div>
            </header>

            <div className="flex-1 overflow-auto">
              {children}
            </div>

            {currentPageName !== "Home" && currentPageName !== "ParkingLot" && (
              <Button
                onClick={() => {
                  const event = new CustomEvent('open-voice-assistant');
                  window.dispatchEvent(event);
                }}
                size="lg"
                className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl z-50 bg-purple-600 hover:bg-purple-700"
                style={{ marginBottom: 'max(1.5rem, calc(1.5rem + env(safe-area-inset-bottom)))' }}
              >
                <Mic className="w-6 h-6" />
              </Button>
            )}
          </main>

          <UniversalVoiceAssistant theme={theme} currentPageName={currentPageName} />
          <MicrophonePermissionCheck theme={theme} />
      </TooltipProvider>
    </div>
  );
}

export default function Layout({ children, currentPageName }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState(null);
  const [authCheckComplete, setAuthCheckComplete] = useState(false);

  // List of public pages that don't require authentication
  const publicPages = ['DeleteAccount', 'DeleteData', 'PrivacyPolicy', 'TermsAndConditions'];
  const isPublicPage = publicPages.includes(currentPageName);

  const checkUserStatusAndTrial = useCallback(async () => {
    if (isPublicPage) {
      setAuthCheckComplete(true);
      return;
    }

    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      // Sync theme from user profile to localStorage so Layout picks it up
      if (currentUser?.theme) {
        localStorage.setItem('adhd_theme', currentUser.theme);
      }
      if (currentUser?.special_mode) {
        localStorage.setItem('special_mode', currentUser.special_mode);
      }
      setAuthCheckComplete(true);
    } catch (error) {
      console.error("Error checking user status:", error);
      base44.auth.redirectToLogin(window.location.href);
    }
  }, [isPublicPage]);

  useEffect(() => {
    checkUserStatusAndTrial();
  }, [checkUserStatusAndTrial]);

  if (!authCheckComplete) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-gray-300 border-t-green-500 rounded-full animate-spin"></div>
          <p className="text-lg font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Render public pages without sidebar
  if (isPublicPage) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <LayoutContent children={children} currentPageName={currentPageName} user={user} authCheckComplete={authCheckComplete} />
    </SidebarProvider>
  );
}