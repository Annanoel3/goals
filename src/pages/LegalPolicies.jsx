import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const Section = ({ title, children, theme }) => (
  <div className="space-y-3">
    <h2 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
    {children}
  </div>
);

const P = ({ children, theme }) => (
  <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{children}</p>
);

const List = ({ items, theme }) => (
  <ul className={`text-sm space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
    {items.map((item, i) => (
      <li key={i} className="flex items-start gap-2">
        <span className="mt-1 text-green-500 flex-shrink-0">•</span>
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

export default function LegalPolicies() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');

  useEffect(() => {
    const interval = setInterval(() => {
      setTheme(localStorage.getItem('adhd_theme') || 'minimalist');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const bg = theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900';
  const cardBg = theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const divider = theme === 'dark' ? 'border-gray-700' : 'border-gray-100';

  return (
    <div className={`min-h-screen ${bg}`} style={{
      paddingTop: 'max(1rem, calc(1rem + env(safe-area-inset-top)))',
      paddingBottom: 'max(3rem, calc(3rem + env(safe-area-inset-bottom)))'
    }}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Button 
          variant="ghost" 
          onClick={() => navigate('/settings')}
          className="mb-6 p-3 h-12 text-base rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-7 h-7 text-green-600" />
          <h1 className="text-2xl font-bold">Legal Policies</h1>
        </div>
        <p className={`text-xs mb-8 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          Privacy Policy · Terms & Conditions · Intellectual Property & Copyright
        </p>

        <div className={`rounded-2xl border divide-y ${cardBg} ${divider}`}>

          {/* PRIVACY POLICY SECTION */}
          <div className="p-5 space-y-3">
            <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Privacy Policy</h2>
            <P theme={theme}>Goals is a comprehensive goal planning and progress tracking application. This policy explains what data we collect, how we use it, and how we protect it.</P>
          </div>

          <div className="p-5">
            <Section title="What We Collect" theme={theme}>
              <List theme={theme} items={[
                "Name and email address",
                "Profile picture (optional)",
                "Goals, milestones, tasks, steps, and notes you create",
                "Energy logs and mood check-ins",
                "Achievements, streaks, and progress data",
                "Messages with accountability partners",
                "Focus room participation and activity",
                "Device type and push notification tokens (for reminders)",
                "Subscription status via Apple App Store or Google Play (we never store card details)",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="How We Use Your Data" theme={theme}>
              <List theme={theme} items={[
                "To run the app and manage your goals, tasks, and reminders",
                "To send push notifications for reminders and daily habits you've set",
                "To enable accountability partner features and messaging",
                "To track your progress, streaks, and achievements",
                "To provide AI-powered goal planning and coaching",
                "To moderate community content for safety",
                "To process your subscription and verify purchases",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="Community Safety" theme={theme}>
              <P theme={theme}>
                All messages in focus rooms and accountability connections are scanned by AI for inappropriate content and personal information sharing. Messages are not manually read unless reported. Users can report and block others at any time. We take reports seriously and review them promptly.
              </P>
              <P theme={theme}>
                Goals cannot guarantee the actions of other users. If you encounter suspicious behavior, block and report the user immediately.
              </P>
            </Section>
          </div>

          <div className="p-5">
            <Section title="Data Sharing" theme={theme}>
              <P theme={theme}>We do not sell your data. We only share it in these cases:</P>
              <List theme={theme} items={[
                "With accountability partners — when you connect with someone, they can see your shared progress and messages",
                "With service providers — cloud hosting, push notifications (OneSignal), and payment processors, solely to operate the app",
                "When legally required — court orders or to protect user safety",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="Your Privacy Rights" theme={theme}>
              <List theme={theme} items={[
                "Access and edit your data anytime in the app",
                "Disable push notifications in your device settings",
                "Request deletion of your data or account",
              ]} />
              <div className="flex flex-wrap gap-2 mt-4">
                <Button onClick={() => navigate(createPageUrl("DeleteData"))} variant="outline" size="sm" className="text-blue-600 border-blue-600 hover:bg-blue-50">
                  Delete My Data
                </Button>
                <Button onClick={() => navigate(createPageUrl("DeleteAccount"))} variant="outline" size="sm" className="text-red-600 border-red-600 hover:bg-red-50">
                  Delete My Account
                </Button>
              </div>
            </Section>
          </div>

          <div className="p-5">
            <Section title="Children" theme={theme}>
              <P theme={theme}>Goals is not intended for children under 13. We do not knowingly collect data from children under 13. Contact us immediately if you believe this has occurred.</P>
            </Section>
          </div>

          <div className="p-5">
            <Section title="Policy Updates" theme={theme}>
              <P theme={theme}>We may update this policy occasionally. We'll notify you of material changes in the app. Continued use after changes means you accept the updated policy.</P>
            </Section>
          </div>

          {/* TERMS & CONDITIONS SECTION */}
          <div className="p-5 space-y-3">
            <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Terms & Conditions</h2>
            <P theme={theme}>By using Goals, you agree to these Terms and Conditions. If you don't agree, please do not use the app.</P>
          </div>

          <div className="p-5">
            <Section title="1. Eligibility" theme={theme}>
              <List theme={theme} items={[
                "You must be at least 13 years of age",
                "You have the legal capacity to enter into this agreement",
                "All information you provide is accurate and truthful",
                "You will use the app in compliance with all applicable laws",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="2. Account Responsibilities" theme={theme}>
              <List theme={theme} items={[
                "You are responsible for keeping your account credentials secure",
                "Notify us immediately of any unauthorized account access",
                "You may only create one account per person",
                "Provide accurate information and keep it up to date",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="3. Acceptable Use" theme={theme}>
              <P theme={theme}>You agree NOT to:</P>
              <List theme={theme} items={[
                "Post harmful, abusive, harassing, or illegal content",
                "Impersonate any person or entity",
                "Spam, phish, or engage in fraudulent activities",
                "Attempt to access other users' accounts or our systems without authorization",
                "Upload viruses or malicious code",
                "Use the app for commercial purposes without our consent",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="4. Subscriptions & Payments" theme={theme}>
              <List theme={theme} items={[
                "New users receive a free trial period. You may cancel anytime during the trial without charge.",
                "After the trial, a subscription is required to continue using Goals.",
                "Subscriptions are billed through Apple App Store or Google Play and auto-renew unless canceled at least 24 hours before renewal.",
                "Cancel anytime through your App Store or Google Play account settings.",
                "Refunds are subject to App Store or Google Play policies.",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="5. Disclaimer" theme={theme}>
              <P theme={theme}>Goals is provided "as is" without warranties of any kind. We do not guarantee uninterrupted or error-free service and are not responsible for data loss or damages arising from your use of the app.</P>
              <P theme={theme}><strong>Not a medical service:</strong> Goals is a productivity and planning tool and is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider regarding medical conditions.</P>
            </Section>
          </div>

          <div className="p-5">
            <Section title="6. Limitation of Liability" theme={theme}>
              <P theme={theme}>To the maximum extent permitted by law, Goals and its owners shall not be liable for any indirect, incidental, or consequential damages resulting from your use or inability to use the app, unauthorized access to your data, or content posted by other users.</P>
            </Section>
          </div>

          <div className="p-5">
            <Section title="7. Termination" theme={theme}>
              <P theme={theme}>We may suspend or terminate your account at any time for violations of these terms, abusive behavior, or to protect our users and services. You may delete your account at any time.</P>
              <div className="mt-2">
                <Button onClick={() => navigate(createPageUrl("DeleteAccount"))} variant="outline" size="sm" className="text-red-600 border-red-600 hover:bg-red-50">
                  Delete My Account
                </Button>
              </div>
            </Section>
          </div>

          <div className="p-5">
            <Section title="8. Changes to Terms" theme={theme}>
              <P theme={theme}>We may update these terms occasionally. We'll notify you of material changes in the app. Continued use after changes means you accept the updated terms.</P>
            </Section>
          </div>

          <div className="p-5">
            <Section title="9. Governing Law" theme={theme}>
              <P theme={theme}>These terms are governed by applicable law where Goals is registered. Any disputes shall be resolved in the courts of that jurisdiction.</P>
            </Section>
          </div>

          {/* INTELLECTUAL PROPERTY & COPYRIGHT SECTION */}
          <div className="p-5 space-y-3">
            <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Intellectual Property & Copyright</h2>
          </div>

          <div className="p-5">
            <Section title="Ownership of Goals" theme={theme}>
              <P theme={theme}>© 2026 Goals. All rights reserved. The Goals application, including its design, code, branding, logo, and user interface, is protected by applicable copyright, trademark, and intellectual property laws. Unauthorized reproduction, distribution, or use of any part of Goals is strictly prohibited.</P>
            </Section>
          </div>

          <div className="p-5">
            <Section title="Your Content License" theme={theme}>
              <List theme={theme} items={[
                "You retain full ownership of all content you create and upload to Goals, including goals, tasks, steps, notes, and descriptions.",
                "By using Goals, you grant us a limited, non-exclusive, royalty-free license to store, process, and display your content solely to provide the service to you.",
                "You may request deletion of your content at any time through account settings.",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="Third-Party Intellectual Property" theme={theme}>
              <List theme={theme} items={[
                "Third-party names, trademarks, logos, and brand names referenced in or integrated with Goals are the property of their respective owners.",
                "Goals is not affiliated with, endorsed by, or sponsored by any third-party service providers or brands.",
                "Use of third-party integrations (e.g., Google, OneSignal) is subject to their respective terms of service and privacy policies.",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="Permitted Use" theme={theme}>
              <P theme={theme}>You are granted a limited, non-transferable, non-exclusive right to use Goals for personal, non-commercial purposes only. You may not:</P>
              <List theme={theme} items={[
                "Copy, reproduce, distribute, or publicly display any part of Goals",
                "Create derivative works, modifications, or unauthorized adaptations",
                "Reverse engineer, decompile, or disassemble the app or its code",
                "Use Goals for commercial purposes without prior written consent",
                "Resell, rent, lease, or lend the app or any of its features",
                "Remove or alter any copyright, trademark, or intellectual property notices",
              ]} />
            </Section>
          </div>

          <div className="p-5">
            <Section title="Licensing Inquiries" theme={theme}>
              <P theme={theme}>If you are interested in licensing, commercial partnerships, or require written permission for any use of Goals beyond personal use, please contact us at{' '}
                <a href="mailto:mediocreatbestdev@outlook.com" className="text-blue-500 hover:underline">
                  mediocreatbestdev@outlook.com
                </a>
              </P>
            </Section>
          </div>

          <div className="p-5">
            <Section title="DMCA & Copyright Complaints" theme={theme}>
              <P theme={theme}>If you believe your intellectual property rights have been violated on Goals, please notify us with the following information:</P>
              <List theme={theme} items={[
                "A detailed description of the copyrighted work or trademark",
                "A description of where the infringing content is located",
                "Your contact information and statement under penalty of perjury",
                "Your signature (physical or electronic)",
              ]} />
              <P theme={theme}>Send DMCA notices to{' '}
                <a href="mailto:mediocreatbestdev@outlook.com" className="text-blue-500 hover:underline">
                  mediocreatbestdev@outlook.com
                </a>
              </P>
            </Section>
          </div>

          {/* CONTACT & FOOTER */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-blue-500" />
              <span className={`text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Contact</span>
            </div>
            <P theme={theme}>Questions about our legal policies? Email us at{' '}
              <a href="mailto:mediocreatbestdev@outlook.com" className="text-blue-500 hover:underline">
                mediocreatbestdev@outlook.com
              </a>
            </P>
            <p className={`text-xs mt-3 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>© 2026 Goals. All rights reserved.</p>
            <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Last updated: May 2026</p>
          </div>

        </div>
      </div>
    </div>
  );
}