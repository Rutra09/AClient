#include "menus.h"
#include <engine/cloud.h>
#include <engine/client/cloud.h>
#include <game/client/gameclient.h>
#include <game/client/ui.h>
#include <game/client/ui_listbox.h>
#include <game/localization.h>

using namespace FontIcons;

void CMenus::RenderCloud(CUIRect MainView)
{
	CUIRect Label, Button, Left, Right, LoginArea, SyncArea, StatusArea, AssetArea, InventoryArea;
	
	// Status message at top
	MainView.HSplitTop(30.0f, &StatusArea, &MainView);
	StatusArea.HSplitTop(25.0f, &Label, nullptr);
	Ui()->DoLabel(&Label, Cloud()->GetStatusMessage(), 16.0f, TEXTALIGN_MC);
	
	MainView.HSplitTop(10.0f, nullptr, &MainView);
	
	bool bLoggedIn = Cloud()->IsLoggedIn();

	// Login Area - only show if not logged in
	if(!bLoggedIn)
	{
		MainView.HSplitTop(150.0f, &LoginArea, nullptr);
		
		LoginArea.HSplitTop(30.0f, &Label, &LoginArea);
		Ui()->DoLabel(&Label, Localize("Cloud Login"), 20.0f, TEXTALIGN_ML);
		LoginArea.HSplitTop(5.0f, nullptr, &LoginArea);
		LoginArea.VSplitMid(&Left, &Right, 20.0f);

		// Username
		Left.HSplitTop(20.0f, &Label, &Left);
		Ui()->DoLabel(&Label, Localize("Username"), 14.0f, TEXTALIGN_ML);
		Left.HSplitTop(20.0f, &Button, &Left);
		Ui()->DoEditBox(&m_CloudUsernameInput, &Button, 14.0f);

		// Password
		Right.HSplitTop(20.0f, &Label, &Right);
		Ui()->DoLabel(&Label, Localize("Password"), 14.0f, TEXTALIGN_ML);
		Right.HSplitTop(20.0f, &Button, &Right);
		Ui()->DoEditBox(&m_CloudPasswordInput, &Button, 14.0f);

		// Buttons
		Left.HSplitTop(10.0f, nullptr, &Left);
		Left.HSplitTop(25.0f, &Button, &Left);
		static CButtonContainer s_LoginButton;
		if(DoButton_Menu(&s_LoginButton, Localize("Login"), 0, &Button))
		{
			Cloud()->Login(m_CloudUsernameInput.GetString(), m_CloudPasswordInput.GetString());
		}

		Right.HSplitTop(10.0f, nullptr, &Right);
		Right.HSplitTop(25.0f, &Button, &Right);
		static CButtonContainer s_RegisterButton;
		if(DoButton_Menu(&s_RegisterButton, Localize("Register"), 0, &Button))
		{
			Cloud()->Register(m_CloudUsernameInput.GetString(), m_CloudPasswordInput.GetString());
		}
	}
	else
	{
		// Logged in - show sync and inventory
		MainView.VSplitMid(&Left, &Right, 20.0f);
		
		// Left side: Sync and Upload
		{
			Left.HSplitTop(30.0f, &Label, &SyncArea);
			char aBuf[128];
			str_format(aBuf, sizeof(aBuf), "%s: %s", Localize("Logged in as"), m_CloudUsernameInput.GetString());
			Ui()->DoLabel(&Label, aBuf, 16.0f, TEXTALIGN_MC);

			SyncArea.HSplitTop(10.0f, nullptr, &SyncArea);
			SyncArea.HSplitTop(25.0f, &Label, &SyncArea);
			Ui()->DoLabel(&Label, Localize("Synchronization"), 18.0f, TEXTALIGN_ML);
			SyncArea.HSplitTop(5.0f, nullptr, &SyncArea);

			// Settings buttons
			SyncArea.HSplitTop(25.0f, &Button, &SyncArea);
			static CButtonContainer s_UploadSettingsButton;
			if(DoButton_Menu(&s_UploadSettingsButton, Localize("Upload Settings"), 0, &Button))
			{
				Cloud()->SyncSettings(true);
			}

			SyncArea.HSplitTop(5.0f, nullptr, &SyncArea);
			SyncArea.HSplitTop(25.0f, &Button, &SyncArea);
			static CButtonContainer s_DownloadSettingsButton;
			if(DoButton_Menu(&s_DownloadSettingsButton, Localize("Download Settings"), 0, &Button))
			{
				Cloud()->SyncSettings(false);
			}

			// Asset Upload Section
			SyncArea.HSplitTop(15.0f, nullptr, &AssetArea);
			AssetArea.HSplitTop(25.0f, &Label, &AssetArea);
			Ui()->DoLabel(&Label, Localize("Upload Assets"), 16.0f, TEXTALIGN_ML);
			
			// Common Files checkboxes
			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadDDNetConfig = 1;
			if(DoButton_CheckBox(&s_UploadDDNetConfig, Localize("DDNet Settings"), s_UploadDDNetConfig, &Button))
				s_UploadDDNetConfig ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadTClientConfig = 1;
			if(DoButton_CheckBox(&s_UploadTClientConfig, Localize("TClient Settings"), s_UploadTClientConfig, &Button))
				s_UploadTClientConfig ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadTClientProfiles = 1;
			if(DoButton_CheckBox(&s_UploadTClientProfiles, Localize("TClient Profiles"), s_UploadTClientProfiles, &Button))
				s_UploadTClientProfiles ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadTClientChatBinds = 1;
			if(DoButton_CheckBox(&s_UploadTClientChatBinds, Localize("TClient Chat Binds"), s_UploadTClientChatBinds, &Button))
				s_UploadTClientChatBinds ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadTClientWarList = 1;
			if(DoButton_CheckBox(&s_UploadTClientWarList, Localize("TClient War List"), s_UploadTClientWarList, &Button))
				s_UploadTClientWarList ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadIdentities = 0;
			if(DoButton_CheckBox(&s_UploadIdentities, Localize("Identities"), s_UploadIdentities, &Button))
				s_UploadIdentities ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadTouchControls = 0;
			if(DoButton_CheckBox(&s_UploadTouchControls, Localize("Touch Controls"), s_UploadTouchControls, &Button))
				s_UploadTouchControls ^= 1;

			// Separator
			AssetArea.HSplitTop(10.0f, nullptr, &AssetArea);
			AssetArea.HSplitTop(20.0f, &Label, &AssetArea);
			Ui()->DoLabel(&Label, Localize("Game Assets"), 14.0f, TEXTALIGN_ML);

			// Game asset folders
			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadEntities = 0;
			if(DoButton_CheckBox(&s_UploadEntities, Localize("Entities (assets/entities/)"), s_UploadEntities, &Button))
				s_UploadEntities ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadEmoticons = 0;
			if(DoButton_CheckBox(&s_UploadEmoticons, Localize("Emoticons (assets/emoticons/)"), s_UploadEmoticons, &Button))
				s_UploadEmoticons ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadParticles = 0;
			if(DoButton_CheckBox(&s_UploadParticles, Localize("Particles (assets/particles/)"), s_UploadParticles, &Button))
				s_UploadParticles ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadGame = 0;
			if(DoButton_CheckBox(&s_UploadGame, Localize("Game (assets/game/)"), s_UploadGame, &Button))
				s_UploadGame ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadHud = 0;
			if(DoButton_CheckBox(&s_UploadHud, Localize("HUD (assets/hud/)"), s_UploadHud, &Button))
				s_UploadHud ^= 1;

			AssetArea.HSplitTop(20.0f, &Button, &AssetArea);
			static int s_UploadExtras = 0;
			if(DoButton_CheckBox(&s_UploadExtras, Localize("Extras (assets/extras/)"), s_UploadExtras, &Button))
				s_UploadExtras ^= 1;

			AssetArea.HSplitTop(10.0f, nullptr, &AssetArea);
			AssetArea.HSplitTop(25.0f, &Button, &AssetArea);
			static CButtonContainer s_UploadSelectedButton;
			if(DoButton_Menu(&s_UploadSelectedButton, Localize("Upload Selected"), 0, &Button))
			{
				if(s_UploadDDNetConfig)
					Cloud()->UploadAsset("settings_ddnet.cfg");
				if(s_UploadTClientConfig)
					Cloud()->UploadAsset("settings_tclient.cfg");
				if(s_UploadTClientProfiles)
					Cloud()->UploadAsset("tclient_profiles.cfg");
				if(s_UploadTClientChatBinds)
					Cloud()->UploadAsset("tclient_chatbinds.cfg");
				if(s_UploadTClientWarList)
					Cloud()->UploadAsset("tclient_warlist.cfg");
				if(s_UploadIdentities)
					Cloud()->UploadAsset("identities.json");
				if(s_UploadTouchControls)
					Cloud()->UploadAsset("touch_controls.json");
				
				// Game asset folders
				if(s_UploadEntities)
					Cloud()->UploadAssetFolder("assets/entities");
				if(s_UploadEmoticons)
					Cloud()->UploadAssetFolder("assets/emoticons");
				if(s_UploadParticles)
					Cloud()->UploadAssetFolder("assets/particles");
				if(s_UploadGame)
					Cloud()->UploadAssetFolder("assets/game");
				if(s_UploadHud)
					Cloud()->UploadAssetFolder("assets/hud");
				if(s_UploadExtras)
					Cloud()->UploadAssetFolder("assets/extras");
			}
		}

		// Right side: Inventory
		{
			Right.HSplitTop(30.0f, &Label, &InventoryArea);
			Ui()->DoLabel(&Label, Localize("Cloud Inventory"), 18.0f, TEXTALIGN_MC);
			
			InventoryArea.HSplitTop(5.0f, nullptr, &InventoryArea);
			
			// Get inventory count
			CCloud *pCloud = (CCloud*)Cloud();
			int NumItems = pCloud->GetInventoryCount();
			
			// Download All buttons
			if(NumItems > 0)
			{
				CUIRect DownloadAllRow, DownloadAllAssetsBtn, DownloadAllConfigsBtn, RefreshBtn;
				InventoryArea.HSplitTop(25.0f, &DownloadAllRow, &InventoryArea);
				DownloadAllRow.VSplitLeft(DownloadAllRow.w / 3.0f, &RefreshBtn, &DownloadAllRow);
				DownloadAllRow.VSplitMid(&DownloadAllAssetsBtn, &DownloadAllConfigsBtn);
				RefreshBtn.VMargin(2.0f, &RefreshBtn);
				DownloadAllAssetsBtn.VMargin(2.0f, &DownloadAllAssetsBtn);
				DownloadAllConfigsBtn.VMargin(2.0f, &DownloadAllConfigsBtn);
				
				static CButtonContainer s_RefreshButton;
				if(DoButton_Menu(&s_RefreshButton, Localize("Refresh"), 0, &RefreshBtn))
				{
					Cloud()->GetInventory();
				}
				
				// static CButtonContainer s_DownloadAllAssetsButton;
				// if(DoButton_Menu(&s_DownloadAllAssetsButton, Localize("DL All Assets"), 0, &DownloadAllAssetsBtn))
				// {
				// 	for(int i = 0; i < NumItems; i++)
				// 	{
				// 		const CCloud::SInventoryAsset *pAsset = pCloud->GetInventoryAsset(i);
				// 		if(pAsset && str_find(pAsset->m_aFilename, "assets/"))
				// 			Cloud()->DownloadAsset(pAsset->m_aFilename);
				// 	}
				// }
				
				static CButtonContainer s_DownloadAllConfigsButton;
				if(DoButton_Menu(&s_DownloadAllConfigsButton, Localize("DL Configs"), 0, &DownloadAllConfigsBtn))
				{
					for(int i = 0; i < NumItems; i++)
					{
						const CCloud::SInventoryAsset *pAsset = pCloud->GetInventoryAsset(i);
						if(pAsset && !str_find(pAsset->m_aFilename, "assets/"))
							Cloud()->DownloadAsset(pAsset->m_aFilename);
					}
				}
				
				InventoryArea.HSplitTop(5.0f, nullptr, &InventoryArea);
			}
			
			if(NumItems > 0)
			{
				static CScrollRegion s_ScrollRegion;
				vec2 ScrollOffset(0.0f, 0.0f);
				CScrollRegionParams ScrollParams;
				ScrollParams.m_ScrollUnit = 25.0f;
				s_ScrollRegion.Begin(&InventoryArea, &ScrollOffset, &ScrollParams);
				InventoryArea.y += ScrollOffset.y;

				for(int i = 0; i < NumItems; i++)
				{
					const CCloud::SInventoryAsset *pAsset = pCloud->GetInventoryAsset(i);
					if(!pAsset)
						continue;

					CUIRect ItemRect, BadgeRect, PathRect, InfoRect, ButtonRect;
					InventoryArea.HSplitTop(25.0f, &ItemRect, &InventoryArea);
					s_ScrollRegion.AddRect(ItemRect);
					
					// Badge for file type
					ItemRect.VSplitLeft(60.0f, &BadgeRect, &ItemRect);
					ItemRect.VSplitLeft(200.0f, &PathRect, &ItemRect);
					ItemRect.VSplitLeft(100.0f, &InfoRect, &ButtonRect);

					// File type badge
					char aBadge[32];
					if(str_find(pAsset->m_aFilename, "assets/"))
						str_copy(aBadge, "[ASSET]", sizeof(aBadge));
					else if(str_find(pAsset->m_aFilename, ".cfg"))
						str_copy(aBadge, "[CONFIG]", sizeof(aBadge));
					else if(str_find(pAsset->m_aFilename, ".json"))
						str_copy(aBadge, "[JSON]", sizeof(aBadge));
					else
						str_copy(aBadge, "[FILE]", sizeof(aBadge));
					
					Ui()->DoLabel(&BadgeRect, aBadge, 10.0f, TEXTALIGN_MC);

					// Full path
					Ui()->DoLabel(&PathRect, pAsset->m_aFilename, 10.0f, TEXTALIGN_ML);

					// Version info
					char aInfo[128];
					str_format(aInfo, sizeof(aInfo), "v%d (%d KB)", pAsset->m_LatestVersion, pAsset->m_TotalSize / 1024);
					Ui()->DoLabel(&InfoRect, aInfo, 10.0f, TEXTALIGN_ML);

					// Download button
					ButtonRect.VSplitLeft(60.0f, &Button, &ButtonRect);
					static CButtonContainer s_DownloadButtons[100];
					if(i < 100 && DoButton_Menu(&s_DownloadButtons[i], "DL", 0, &Button))
					{
						Cloud()->DownloadAsset(pAsset->m_aFilename);
					}

					InventoryArea.HSplitTop(2.0f, nullptr, &InventoryArea);
				}
				
				s_ScrollRegion.End();
			}
			else
			{
				InventoryArea.HSplitTop(30.0f, &Label, &InventoryArea);
				Ui()->DoLabel(&Label, Localize("No assets uploaded yet"), 14.0f, TEXTALIGN_MC);
			}
		}
	}
}
