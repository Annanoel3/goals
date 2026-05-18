import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { userEmail, title, message, data, subscriptionId } = body;

        const appId = Deno.env.get("ONESIGNAL_APP_ID");
        const rest = Deno.env.get("ONESIGNAL_REST_API_KEY");

        if (!appId || !rest) {
            return Response.json({ success: false, error: "Missing OneSignal credentials" }, { status: 500 });
        }

        // Build the notification payload
        // Priority: subscriptionId > externalId (email) > player IDs from DB
        let payload;

        if (subscriptionId) {
            // Target a specific subscription/player ID directly
            payload = {
                app_id: appId.trim(),
                include_subscription_uuids: [subscriptionId],
                headings: { en: title },
                contents: { en: message },
                data: data || {}
            };
            console.log('Sending push to subscription ID:', subscriptionId);
        } else if (userEmail) {
            // Target by external user ID (email) — this is the primary flow
            payload = {
                app_id: appId.trim(),
                include_aliases: { external_id: [userEmail] },
                target_channel: "push",
                headings: { en: title },
                contents: { en: message },
                data: data || {}
            };
            console.log('Sending push to external ID:', userEmail);
        } else {
            return Response.json({ success: false, error: 'No target provided (userEmail or subscriptionId required)' });
        }

        const response = await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Basic ${rest.trim()}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log('OneSignal response:', JSON.stringify(result));

        if (!response.ok || result.errors) {
            return Response.json({
                success: false,
                error: result.errors?.[0] || "Failed to send notification",
                details: result
            });
        }

        return Response.json({ 
            success: true,
            recipients: result.recipients || 0,
            data: result
        });

    } catch (error) {
        console.error('[OneSignal] Send error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});