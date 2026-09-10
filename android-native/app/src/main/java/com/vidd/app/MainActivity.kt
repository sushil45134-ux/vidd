package com.vidd.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vidd.app.ui.ViddNav
import com.vidd.app.ui.ViddTheme

class MainActivity : ComponentActivity() {

    private val notifPerm =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_VidNative)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Pichhli baar crash hua tha to report dikhao (turant fix me kaam aayegi)
        val crash = CrashReport.read(this)
        if (crash != null) {
            setContent {
                ViddTheme {
                    CrashScreen(
                        text = crash,
                        onShare = {
                            startActivity(
                                Intent.createChooser(CrashReport.shareIntent(crash), "Report bhejo")
                            )
                        },
                        onRetry = {
                            CrashReport.clear(this)
                            recreate()
                        },
                    )
                }
            }
            return
        }

        // Naye videos ki notification ke liye permission (sirf ek baar puchega)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            ViddTheme { ViddNav() }
        }
    }
}

@Composable
private fun CrashScreen(text: String, onShare: () -> Unit, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("😢", fontSize = 48.sp)
        Spacer(Modifier.height(12.dp))
        Text(
            "App me dikkat aayi", color = Color.White, fontSize = 19.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Share dabakar ye report bhejo — main turant theek kar dunga.",
            color = Color(0xFF9E9E9E), fontSize = 13.sp, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Box(
            modifier = Modifier.fillMaxWidth().height(180.dp)
                .background(Color(0xFF1C1C1C), RoundedCornerShape(8.dp))
                .padding(8.dp),
        ) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(text.take(3000), color = Color(0xFFBBBBBB), fontSize = 10.sp)
            }
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onShare,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE50914)),
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Report Share Karo", color = Color.White) }
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF333333)),
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Phir Se Kholo", color = Color.White) }
    }
}
