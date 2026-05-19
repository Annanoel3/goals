import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail, AlertTriangle, Database, Shield, Clock, Trash2, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function DeleteData() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setTheme(localStorage.getItem('adhd_theme') || 'minimalist');
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteAllData = async () => {
    setDeleting(true);
    try {
      const user = await base44.auth.me();
      await Promise.all([
        base44.entities.Task.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.Task.delete(i.id)))
        ),
        base44.entities.Goal.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.Goal.delete(i.id)))
        ),
        base44.entities.GoalStep.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.GoalStep.delete(i.id)))
        ),
        base44.entities.ParkingLotIdea.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.ParkingLotIdea.delete(i.id)))
        ),
        base44.entities.EnergyLog.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.EnergyLog.delete(i.id)))
        ),
        base44.entities.DailySummary.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.DailySummary.delete(i.id)))
        ),
        base44.entities.Achievement.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.Achievement.delete(i.id)))
        ),
        base44.entities.MoodCheckIn.filter({ created_by: user.email }).then(items =>
          Promise.all(items.map(i => base44.entities.MoodCheckIn.delete(i.id)))
        ),
      ]);
      setDeleted(true);
    } catch (error) {
      console.error('Error deleting data:', error);
    }
    setDeleting(false);
    setShowConfirm(false);
  };

  const cardBg = theme === 'dark' ? 'bg-gray-800' : 'bg-white';

  return (
    <div className="min-h-screen p-4 md:p-8" style={{
      paddingTop: 'max(1rem, calc(1rem + env(safe-area-inset-top)))',
      paddingBottom: 'max(2rem, calc(2rem + env(safe-area-inset-bottom)))'
    }}>
      <div className="max-w-2xl mx-auto">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <Card className={`border-none shadow-lg mb-6 ${cardBg}`}>
          <CardHeader>
            <CardTitle className={`text-3xl break-words ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              Data & Account Deletion
            </CardTitle>
            <p className={`text-sm mt-2 break-words ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Manage your personal data
            </p>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Delete Account link */}
            <div className={`p-4 rounded-lg border-2 ${theme === 'dark' ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'}`}>
              <h3 className={`font-semibold mb-1 ${theme === 'dark' ? 'text-red-400' : 'text-red-900'}`}>
                Want to delete your entire account?
              </h3>
              <p className={`text-sm mb-3 ${theme === 'dark' ? 'text-red-300' : 'text-red-800'}`}>
                This will permanently remove your account and all associated data.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(createPageUrl("DeleteAccount"))}
                className="text-red-600 border-red-400 hover:bg-red-50"
              >
                Request Account Deletion →
              </Button>
            </div>

            {/* In-app delete all data */}
            <div className={`p-5 rounded-xl border-2 ${theme === 'dark' ? 'bg-orange-900/20 border-orange-700' : 'bg-orange-50 border-orange-300'}`}>
              <h2 className={`text-xl font-bold mb-2 flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                <Trash2 className="w-5 h-5 flex-shrink-0" />
                Delete All My Data (Keep Account)
              </h2>
              <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                Instantly and permanently delete all your goals, tasks, parking lot ideas, progress data, achievements, and mood check-ins. Your account stays active but starts fresh.
              </p>

              {deleted ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">All data deleted successfully.</span>
                </div>
              ) : (
                <Button
                  onClick={() => setShowConfirm(true)}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All My Data
                </Button>
              )}
            </div>

            {/* Request partial deletion via email */}
            <div className={`p-5 rounded-xl border-2 ${theme === 'dark' ? 'bg-blue-900/20 border-blue-700' : 'bg-blue-50 border-blue-300'}`}>
              <h2 className={`text-xl font-bold mb-2 flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                <Database className="w-5 h-5 flex-shrink-0" />
                Request Specific Data Deletion
              </h2>
              <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                Need to delete specific categories or date ranges? Email us and we'll process your request within 30 days.
              </p>
              <p className={`text-sm mb-1 font-medium ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                Include in your email:
              </p>
              <ul className={`text-sm list-disc list-inside mb-4 space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <li>The email address associated with your account</li>
                <li>Which data you want deleted (e.g. "all tasks", "chat history")</li>
                <li>Any specific date ranges</li>
              </ul>
              <Button
                onClick={() => window.location.href = 'mailto:goals.space@gmail.com?subject=Data%20Deletion%20Request&body=Hello%2C%0A%0AI%20would%20like%20to%20request%20deletion%20of%20specific%20data%20from%20my%20account.%0A%0AAccount%20Email%3A%20%5Byour%20email%5D%0AFull%20Name%3A%20%5Byour%20name%5D%0A%0AData%20I%20want%20deleted%3A%0A%5BDescribe%20which%20data%20and%20any%20date%20ranges%5D%0A%0AThank%20you.'}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Mail className="w-4 h-4 mr-2" />
                Email Deletion Request
              </Button>
            </div>

            {/* Retention notice */}
            <div className={`p-4 rounded-lg border ${theme === 'dark' ? 'bg-yellow-900/20 border-yellow-800' : 'bg-yellow-50 border-yellow-200'}`}>
              <h3 className={`font-semibold mb-2 ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-900'}`}>
                Data That Cannot Be Deleted
              </h3>
              <ul className={`list-disc list-inside space-y-1 text-sm ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-800'}`}>
                <li><strong>Financial records</strong> — required by law, retained up to 7 years</li>
                <li><strong>Anonymized reports</strong> — used for safety improvements, retained indefinitely</li>
                <li><strong>System backups</strong> — disaster recovery only, purged within 90 days</li>
              </ul>
            </div>

          </CardContent>
        </Card>
      </div>

      {/* Confirm Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All Your Data?</DialogTitle>
            <DialogDescription>
              This will permanently delete all your goals, tasks, parking lot ideas, progress data, achievements, and mood check-ins. This cannot be undone. Your account will remain active.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button variant="outline" onClick={() => setShowConfirm(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleDeleteAllData}
              disabled={deleting}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Yes, Delete Everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}